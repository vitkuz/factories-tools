# WebSocket-only Studio: plan

Goal: the browser does no interval polling and has no Refresh button. The server watches what
changes on disk and in herdr and pushes it over the one existing socket (`/api/v1/ws`). HTTP stays
for one-shot reads (documents, chat items, the pipeline list of the start form) and for every
mutation. The WS Origin check and the API key rule are untouched.

## 1. Inventory: what the web polled before this change

| Where (web/) | Cadence | Fetched | What changes it on the server |
| --- | --- | --- | --- |
| `features/runs/RunsScreen.tsx` → `usePolling(feed.refresh, 5 s / 30 s)` over `hooks/use-runs-feed.ts` | 5 s while the shown run is RUNNING/PAUSED, 30 s otherwise; also on `visibilitychange` | `GET /api/v1/runs`: every run record (`state.json`, `cost.json`, the run's `pipeline.json` snapshot) and the pipelines map (`factories*/<id>/pipeline.json`) | the recorder (`factories-tools/bin/state.mjs`, a temp file + rename into `run/<folder>/<runId>/state.json`), `ai-usage` writing `cost.json`, the runner copying `pipeline.json` into the run, a new run folder appearing, `DELETE /runs` moving a folder to `run/.trash`, a factory's `pipeline.json` edited on disk |
| `components/LiveStatus.tsx`, `RunsIndex.tsx`, `RunHeader.tsx`, `NoRuns.tsx`, `ErrorScreen.tsx` | — | the **Refresh** / "Check again" / "Try again" buttons calling `feed.refresh` | — |
| `hooks/use-remove-run.ts` | after a DELETE | `feed.refresh()` to recount | the move to `.trash` |
| `features/sessions/hooks/use-sessions.ts` → `usePolling(refresh, 10 s / 60 s)` | 10 s while the socket is down, 60 s while open; the FeedBar **Refresh** button | `GET /api/v1/sessions` (herdr workspaces, labels, meta, Claude session id) | sessions started/stopped (by the studio or by hand), herdr agent status, the SessionStart hook recording the transcript link |
| `features/chat/hooks/use-run-session.ts` → `usePolling(refresh, 15 s)` | 15 s while a run page is open | `GET /api/v1/sessions` again, to tie the run to a live session | same |
| `features/system/hooks/use-system-memory.ts` → `usePolling(tick, 5 s)` | 5 s on every screen | `GET /api/v1/system/memory` | the machine |
| `features/workspaces/hooks/use-workspaces.ts` | once on mount and after every write (`refresh()`) — no timer | `GET /api/v1/workspaces` (`run/workspaces.json`) | the API's own writes, a hand edit of the file |
| `features/sessions/SessionsScreen.tsx` | once on mount | `GET /api/v1/pipelines` for the start form | a new factory on disk (rare; stays a one-shot read) |
| `shared/document-viewer/DocModal.tsx` | once per open doc; `Reload` by hand after a 409 | `GET /runs/:p/:r/<path>`, `GET /pipelines/:id/knowledge/<path>`, `GET /scripts/<path>` | a step writing its output files; a person saving in another tab |
| `shared/lib/use-websocket.ts` (already WS) | reconnect with backoff (1 s → 15 s), pauses while hidden | `hello`, `session.question`, `session.question.resolved`, `session.status`, chat frames | the question hook, `pollSessionStatusFactory` (server-side 2 s herdr poll), the chat tailers |

`useNow` (`shared/lib/polling.ts`) is a render ticker for "updated n s ago" text and makes no
requests; it stays. `usePolling` goes.

Server-side sources of change that are **outside the API process** (agents and tools write files):
`run/<folder>/<runId>/state.json`, `cost.json`, `pipeline.json`, every step output folder, new or
removed run folders, `run/workspaces.json`, `factories*/<id>/pipeline.json`. Inside the API: the
herdr poller (`poll-session-status.service.ts`), the question store, `PUT` run/knowledge documents
(they land on disk, so the watcher sees them too — one path for both).

## 2. Design

### 2.1 Server: change sources → hub

- **`clients/watch/watch.client.ts`** — the one IO boundary over `fs.watch(dir, { recursive: true })`
  (Node ≥ 20 on Linux and macOS). `watchTree(dir, onEvent)` returns `stop()`. A folder that is not
  there yet (`run/` on a fresh checkout) is watched through its parent, non-recursively, until it
  appears, then switched to a recursive watch of the folder itself. Watcher errors are logged and the
  watch is retried after a pause; nothing throws out of it.
- **`shared/utils/debounce.utils.ts`** — `debounceByKey(ms, flush)`: trailing debounce per key that
  coalesces the payloads (paths) seen for that key; pure apart from the timer, injectable `setTimer`
  for tests. The recorder writes `state.json.tmp-<pid>` then renames, so one logical write is two or
  three inotify events: the debounce (250 ms) folds them into one push.
- **`features/live/`** (new feature, the fan-out):
  - `live.schema.ts` — Zod: `liveTopicSchema` (`runs` | `sessions` | `workspaces` | `system`),
    client frames `live.subscribe { topics }` / `live.unsubscribe { topics }`, server frames
    `runs.snapshot`, `run.changed`, `pipelines.changed`, `sessions.changed`, `workspaces.snapshot`,
    `system.memory` (shapes below).
  - `live.utils.ts` — `classifyRunPath(rel)` (a path under `run/` → `{ kind: 'run', folder, runId, rest }`
    | `{ kind: 'workspaces' }` | `{ kind: 'folder', folder }` | `{ kind: 'ignore' }` for `.trash`,
    dotfiles and temp files), `isRecordFile(rest)` (`state.json` | `cost.json` | `pipeline.json` or the
    run folder itself), `sessionsFingerprint(sessions)` (everything but `ageSeconds`/`age`), `isLiveFrame(raw)`.
  - `services/subscription-registry.service.ts` — who subscribed to which topic: `subscribe(client, topics)`,
    `unsubscribe`, `drop(clientId)`, `publish(topic, message)`, `count(topic)`. A plain closure over
    two maps, replaced not edited.
  - `services/memory-ticker.service.ts` — the only server-side interval added: every 5 s, **only while
    someone subscribes to `system`**, reads memory and publishes `system.memory`.
  - `usecases/publish-run-change.usecase.ts` — a debounced run event → `readRunRecord(folder, runId)`
    (the `toRecord` of `collect-run-records.service.ts`, exported as its own service) → `run.changed`
    with the record, `null` when the folder is gone (`reason: 'gone'`) or its state no longer parses
    (`reason: 'unreadable'`), or no `run` at all when only files under the run changed (then only
    `paths`). A change to a bare `<folder>` (a pipeline folder created or removed) or to anything
    unclassifiable → a fresh `runs.snapshot` to every `runs` subscriber (the rescan).
  - `usecases/publish-pipelines-change.usecase.ts` — `factories/` and `factories.local/` watched
    recursively; a `pipeline.json` written anywhere there (500 ms debounce) → `pipelines.changed { pipelines }`.
  - `usecases/send-snapshot.usecase.ts` — the answer to a subscribe, per topic: `runs.snapshot`
    (= `listRuns()`), `sessions.changed` (= `listSessions()`), `workspaces.snapshot`
    (= `listWorkspaces()`), `system.memory` (= `readMemory()`).
  - `ws/live-message.handler.ts` — parses `live.*` frames, keeps the registry, sends the snapshots.
- **`pollSessionStatusFactory`** keeps its 2 s herdr poll and its `session.status` broadcasts, and
  gains `onChanged(sessions)`: called when the fingerprint of the list differs from the last poll →
  `sessions.changed { sessions }` to the `sessions` subscribers (membership, status, Claude id, labels).
- **`server.ts`**: the socket's `onMessage` dispatches chat → live → questions; `onDisconnect` drops
  the client from the chat hub and the registry; the watchers start after `listen` and are stopped in
  `shutdown`.
- `bus.broadcast` (questions, `session.status`) is unchanged: those go to everyone, as before.

### 2.2 Message types

Server → client (added to the web's `serverMessageSchema` union; each in its feature's `*.schema.ts`):

```
runs.snapshot      { generatedAt, pipelines: Record<id, pipeline>, runs: unknown[] }   // same body as GET /runs
run.changed        { folder, runId, pipelineId?, paths: string[], run?: unknown | null, reason?: 'gone' | 'unreadable' }
pipelines.changed  { pipelines: Record<id, pipeline> }
sessions.changed   { sessions: FactorySession[] }                                        // the whole (small) list
workspaces.snapshot{ exists, workspaces, problem? }                                      // same body as GET /workspaces
system.memory      { totalBytes, usedBytes, availableBytes, usedPercent, loadAverage, cpuCount }
```

`runs` and `run` are `unknown` on the wire on purpose: the web keeps validating run by run
(`parseLivePayload`, `runRecordSchema`) so one half-written `state.json` hides that run and names it
in the footer instead of failing the whole list.

Client → server: `live.subscribe { topics: LiveTopic[] }`, `live.unsubscribe { topics }`.

### 2.3 Subscription model

Topics, not a firehose: `runs` (every run — the sidebar shows all of them on every screen, so a
per-run topic would save nothing), `sessions`, `workspaces`, `system`. A client subscribes on every
socket open (so a reconnect re-subscribes) and is dropped on close. The snapshot is the **first frame
after a subscribe, on the same socket as the deltas**, so a delta can never be overwritten by an older
HTTP snapshot that lands later (the race a `fetch` + socket pair would have). Chat keeps its own
`session.chat.subscribe`; questions stay global (`hello` carries the pending list).

### 2.4 Web

- `shared/lib/polling.ts` loses `usePolling`; `useNow` stays (a render ticker).
- The one socket (`QuestionsProvider` → `useSessionQuestions`) exposes `channel.listen/send` and
  `connection`. Every live hook subscribes through it when `connection === 'open'` and reduces the
  frames it cares about with a pure reducer:
  - `features/runs/hooks/use-runs-feed.ts` → `runs` topic; reducer `reduceRunsFeed` in
    `runs-feed.utils.ts`: `snapshot` replaces (through `mergeStable`, so unchanged objects keep their
    identity), `run.changed` upserts/removes one run and re-sorts (`sortRuns`, ported from the API),
    `pipelines.changed` replaces the map, `disconnected` flips `source` to `unreachable` and keeps the
    data. `RunsFeed.refresh` becomes `resync()` = re-send the subscribe (used by the invalid-list
    error screen's "Try again"; no timer anywhere).
  - `features/sessions/hooks/use-sessions.ts` → the list arrives as `sessions.changed`; the hook keeps
    start/stop/notice; `age`/`ageSeconds` are recomputed in the browser from `startedAt` (`withLiveAge`)
    so a list pushed only on change never shows a stale age.
  - `features/chat/hooks/use-run-session.ts` reads the same pushed list (no second `GET /sessions`).
  - `features/workspaces/hooks/use-workspaces.ts` → `workspaces` topic; writes keep their optimistic
    apply and the watcher's `workspaces.snapshot` confirms; `refresh` goes.
  - `features/system/hooks/use-system-memory.ts` → `system` topic.
  - `shared/document-viewer/DocModal.tsx`: a run document on screen (not in edit mode) reloads
    itself when a `run.changed` names its path — one event-driven HTTP read, no timer.
- **Indicator, no Refresh**: `FeedBar` loses the button and takes the socket state: `Live` (open and
  a snapshot received), `Connecting…` (opening or waiting for the snapshot), `Offline — reconnecting`
  (closed; the last data stays on screen, muted dot). `NoRuns` loses "Check again": the page is
  watching. `useRemoveRun` only forgets the row; the watcher pushes the removal.
- **Socket down**: `useWebSocket` already backs off (1 s doubling to 15 s), waits while hidden and
  reconnects on show. On reopen every hook re-subscribes and the snapshots replace the state: that is
  the "one full refetch" — over the socket, without any HTTP timer. Questions state already handles
  `disconnected` (in-flight answers become errors).

### 2.5 What still uses HTTP, on purpose

One-shot reads: documents (`GET /runs/:p/:r/<path>`, knowledge, scripts), a chat item uncut, the
pipeline list of the start form (once per Sessions mount). Every mutation: start/stop a session,
save a document, create/update/remove a workspace, remove a run. The hook endpoints. `GET /runs`,
`GET /sessions`, `GET /workspaces`, `GET /system/memory` stay in the API for curl and tests; the
browser no longer calls them.

### 2.6 Tests

API: `live.utils` (path classification, fingerprint), `debounce.utils` (coalescing, keys, timers),
subscription registry, the run-change usecase over a temp `WORK_DIR` with a real `fs.watch` (write
`state.json` through a temp file + rename → one `run.changed` within the debounce), the live frame
handler over `attachWebSocket` (subscribe → snapshot), the poller's `onChanged`. Web: `reduceRunsFeed`,
`sortRuns`, `withLiveAge`, the new schemas in the protocol union.

### 2.7 Out of scope (later)

Knowledge-file change events (edits come from the Studio itself; an open knowledge doc keeps the
409 `Reload`/`Overwrite` flow), a per-run topic (not needed while every client lists every run), a
`hello` that carries snapshots (subscribe/snapshot is explicit and cheap).
