# Factory Studio

A runs-only app: one local server and one browser app to follow the factory runs in this
repository and to start the Claude harness sessions that launch them. The Express API in `api/`
(Node 20, port 3100, loopback only) serves the static React app in `web/` from the same origin,
reads the factory data on disk (`factories/<id>/pipeline.json` — the shared kit, a git submodule —
or the project's own `factories.local/<id>/pipeline.json`, with the factory's own `knowledge/`
beside it, the wrapper skills `.claude/skills/<id>/SKILL.md`, `run/<pipeline>/<run-id>/`, the hook
scripts under `scripts/`), writes only run documents (the `input` documents of a `human` step), and
starts, lists and stops a Claude harness in a tmux session from a prompt typed in the browser.

Factory Studio never writes a pipeline: pipelines are edited as JSON (by Claude, or by hand), and a
changed `pipeline.json` shows up on the next poll. The pipeline editor that used to live here was
split off into its own app, `factories-tools/factory-editor/`. Factory Studio replaces three tools
that each needed their own dev server or process — the runs dashboard (`tools/state-dashboard`),
the collected-runs browser (`tools/artifact-collector/front`) and the session starter
(`tools/factory-api`) — and imports nothing from them at runtime.

## Start it

Install, build and start, all from this folder. `npm run build` builds `web` then `api`;
`npm start` runs `node dist/server.js` in `api/`.

```
cd factories-tools/factory-studio
npm install
npm run build
npm start
```

The server logs one JSON line when it is up
(`"message":"factory-studio-api listening","port":3100,"host":"127.0.0.1"`). Check it:

```
curl -s http://127.0.0.1:3100/health
```

answers `{"ok":true}`. Then open `http://127.0.0.1:3100/`.

Start the API **from an interactive shell whose `PATH` holds `claude`**. The harness is spawned
with the API's own `PATH`; if `claude` is not on it, every `Start` on the Sessions screen answers
`502 the claude session exited immediately`, and that is the only diagnostic.

**Stop it** by the PID that holds the port, never with `pkill node` or `fuser -k` (other tools run
node on other ports):

```
ss -ltnp | grep ':3100 '
kill <pid shown by ss>
ss -ltnp | grep ':3100 '
```

The SIGTERM handler logs `shutting down`, closes the HTTP server and frees the port within about a
second; the npm wrappers exit on their own; the second `ss` prints nothing. Stopping the API never
stops a tmux session: sessions outlive it on purpose, and the next start lists them again.

To keep it running after the shell closes, with the log in a file:

```
setsid nohup npm start > <logfile> 2>&1 < /dev/null &
```

Development without a rebuild: `npm run dev:api` (`tsx watch`) plus `npm run dev -w web` (Vite on
`STUDIO_WEB_PORT`, proxying `/api` to `PORT`; see [Ports](#ports)).

Checks that must pass before a change lands:

```
npm run typecheck
npm run format:check
npm test
npm run build
```

`npm test -w api` runs the vitest suite over HTTP against a fake tmux and temporary `WORK_DIR`s;
it needs neither tmux nor `claude`. A rebuilt `web/dist` is served without restarting the API
(reload the browser); a rebuilt `api/dist` needs a restart.

### Ports

Every project that carries this submodule can run its own studio at the same time, so the ports
are per project and live in the project's git-ignored `api/.env`, never in the source. The
numbers in this README are the defaults.

```
cp api/.env.example api/.env   # then set PORT and STUDIO_WEB_PORT to ports no other project uses
```

| Variable | Default | Read by | What it is |
| --- | --- | --- | --- |
| `PORT` | `3100` | the API, and the Vite dev server for its `/api` proxy | the API port |
| `STUDIO_WEB_PORT` | `5175` | the Vite dev server only | the dev server's own port (`strictPort`) |

With no `api/.env` both defaults apply; a value in the shell wins over the file. The Vite dev
server reads the same `api/.env` (it has no env file of its own) and refuses to start on a busy
port instead of moving to the next one. Factory Editor (`../factory-editor`) uses its own `PORT` and `EDITOR_WEB_PORT`. To see which ports this checkout uses and
whether it is up:

```
grep -E '^(PORT|STUDIO_WEB_PORT)=' api/.env   # nothing printed: 3100 and 5175
ss -ltnp | grep ':<PORT> '
```

### Environment

Every variable has a default; nothing has to be set. Values come from `api/.env` (copy
`api/.env.example`) or the shell. An invalid value stops the server before it listens with one line
`invalid environment: <VARIABLE>: <reason>` and exit code 1.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3100` | TCP port |
| `STUDIO_WEB_PORT` | `5175` | Vite dev server port, read only by the dev server; see [Ports](#ports) |
| `HOST` | `127.0.0.1` | bind address; loopback unless set on purpose, because the harness it starts skips every approval prompt |
| `WORK_DIR` | the repository root (two levels above `factories-tools/factory-studio`) | where `factories/` (the kit), `factories.local/`, `.claude/skills/` and `run/` live and where the harness starts |
| `PROMPT_DIR` | `<tmpdir>/factory-studio` | where each session's `<session>.prompt` is written (dir `0700`, file `0600`) |
| `TMUX_BIN` | `/usr/bin/tmux` | the tmux binary |
| `START_GRACE_MS` | `750` | how long a new session must stay alive before a start counts as started |
| `LOG_LEVEL` | `info` | winston level: `error`, `warn`, `info`, `debug` |
| `WEB_DIST` | `factories-tools/factory-studio/web/dist` | the built app served at `/` |
| `API_KEY` | unset | optional; see below |

**The API key.** Unset, every `/api/v1` route is open on loopback and the key middleware is not
attached at all; the listening log line says `"apiKey":"unset"`. To enable it, set
`API_KEY=<16 or more characters>` in `api/.env` (or the shell) and restart: then every `/api/v1`
route requires a matching `x-api-key` header, compared in constant time, answering
`401 { "error": "unauthorized" }` otherwise, and the presented key is never logged. `/health` stays
open either way. **The browser app has no key field and sends no key**, so a set key locks the app
out: every screen would show the `401` as a message. Leave it unset while the app is in use; set it
only for a `curl`-only deployment.

## What you get

One address, `http://127.0.0.1:3100/`, one shell with one navigation (Runs, Sessions), and two
screens. Runs is the landing screen. Switching screens changes the URL, and every URL reloads in
place.

| URL | Screen |
| --- | --- |
| `/` | the Runs index, as `/runs` (the address stays `/`). |
| `/runs` | **Runs index**: totals, a per-pipeline table (a row filters the run table), a per-run table (a row opens the run), and every run grouped by pipeline with status, day and cost; a run without `state.json` shows `no state`; `Live` indicator, "Updated n s ago" footer and `Refresh`; a run with an invalid `state.json` is dropped and named in the footer while the rest still show. |
| `/runs/<pipelineId>/<runId>[#view=detailed]` | **One run**: the runs sidebar on the left (search box, All / Running / Completed / Failed chips, every run grouped by start day — Today, Yesterday, Oct 3 — with status dot, id, pipeline and cost; the shown run marked and kept in view; rows are links, ArrowUp/Down move between them; `‹` folds it to a rail, remembered in the browser), the run's header line (`All runs`, `pipeline /` id, status, day, duration, cost, `Live`), the status-coloured graph with result pills, legend, `Details`, minimap, the inspector (overview, cost breakdown with a `stale` pill, step pane with attempts, per-step cost and prompt), the collapsible log whose step chips select a node, and the document viewer; refetches every 5 s while the run is `RUNNING`/`PAUSED`, every 30 s otherwise, pauses while the tab is hidden, and keeps viewport and selection across refreshes; `Offline` with the last data when the API stops answering; a stateless run shows the definition graph with "No state.json yet". |
| `/sessions` | **Sessions**: a prompt text area, a factory picker, `Start` (disabled until both are filled) which starts a Claude harness in tmux and shows the new row within about a second; the list of running `factory-*` sessions (session, factory, harness, started, age) refreshed every 10 s, with `Stop` on each row; every refusal (`400`, `404`, `409`, `502`) is a notice on the screen. |
| anything else | the Runs index; the address is rewritten to `/runs` without a history entry, so an old `/editor` or `/editor/<id>` bookmark lands on Runs. |

The document viewer opens from the run view: run documents (rendered and raw markdown, text,
images, folder listings, missing and error states, relative links opened on top with `Back`),
knowledge files of the factory (under `factories/<id>/knowledge/`), a step's prompt out of the
pipeline definition, and hook scripts (`scripts/<path>`, read-only). Only the `input` documents of
a `human` step are editable (`Edit`, `Save`, `Ctrl/Cmd+S`, a confirm before discarding); a document
not yet written can be created that way.

## The API

Origin `http://127.0.0.1:3100`. Every `/api/v1` answer carries `Cache-Control: no-store`; every
response carries an `x-request-id` header and one JSON log line (`method`, `path`, `status`, `ms`,
`requestId`). Every error body is `{ error, requestId?, details? }`; nothing ever answers a stack
trace, and a miss under `/api` is JSON, never the app's page. With `API_KEY` set, every `/api/v1`
route may also answer `401 { "error": "unauthorized" }`. `<path>` is one or more URL-encoded
segments; a trailing `/` names a folder. There is no app-wide body parser: JSON (2 MB) is parsed
only on E9 and E11, raw text (2 MB, any content type) only on E8.

| # | Method | Path | Body | Success | Errors |
| --- | --- | --- | --- | --- | --- |
| E1 | GET | `/health` | — | `200 { "ok": true }`, no key | — |
| E2 | GET | `/api/v1/pipelines` | — | `200 { "pipelines": [{ "id", "path", "pipeline" }] }` — every directory under `<WORK_DIR>/factories.local/` and `<WORK_DIR>/factories/` with a `pipeline.json` (a local id shadows the kit's), read fresh, sorted by id; `path` is `factories.local/<id>/pipeline.json` or `factories/<id>/pipeline.json`; a folder without the file or with one that does not parse is not listed | `500` |
| E5 | GET, HEAD | `/api/v1/pipelines/:id/knowledge/<path>` | — | file: `200` bytes with content type (`.md` → `text/markdown`, `.json` → `application/json`, images → `image/*`, code and text → `text/plain`, else `application/octet-stream`) and `Content-Length`; folder: `200 { "kind": "directory", "path", "entries": [{ "name", "type": "file" \| "directory", "size" }] }` (folders first, dotfiles hidden); absent: `200 { "kind": "missing", "path" }`. The path is a knowledge entry as the pipeline spells it: a `{{name}}` naming any other string constant (`{{factoryPath}}`, `{{knowledgePath}}`…) is expanded first, with the built-in `{{id}}`, so `{{factoryPath}}/knowledge/x.md` becomes `{{rootPath}}/factories/<id>/knowledge/x.md`; then a leading `{{rootPath}}/` resolves against `WORK_DIR` (or the pipeline's `constants.rootPath` unless it is `cwd`), a leading `{{skillPath}}/` against the wrapper skill folder `.claude/skills/<id>/`, and a bare path against the folder holding `pipeline.json` (`factories/<id>/`, so `DESIGN.md` or `render/` of a factory open too) | `400 { "error": "invalid path segment" \| "empty path" \| "bad encoding" }`, `403 { "error": "outside the document root" }`, `404 { "error": "pipeline not found" }`, `500` |
| E6 | GET | `/api/v1/runs` | — | `200 { "generatedAt", "pipelines": { <id>: pipeline }, "runs": [{ "runId", "pipelineId", "dir", "hasState", "state", "cost", "hasCost", "pipeline"? }] }` — walks `<WORK_DIR>/run/<pipelineId>/<runId>/` on every call; pipeline id from `state.pipelineName` (or the older `pipeline`) before the folder name; a run whose `state.json` does not parse is skipped (a warning is logged); no `state.json` → `hasState: false, state: null`; unreadable `cost.json` → `cost: null, hasCost: true`; a run's own `pipeline.json` is included as `pipeline` exactly as written — a snapshot from before prompts became line arrays (a string `prompt`, a `systemPrompt`) is served as it is and upgraded by the app, so every old run still draws; sorted newest `createdAt` first, then stateless runs, then by id; unknown fields pass through | `500` |
| E7 | GET, HEAD | `/api/v1/runs/:pipelineId/:runId/<path>` | — | as E5, from `<WORK_DIR>/run/<pipelineId>/<runId>/<path>` | `400`, `403` as E5, `404 { "error": "run not found" }` (also when an id is not a single safe segment), `500` |
| E8 | PUT | `/api/v1/runs/:pipelineId/:runId/<path>` | raw text, any content type (the app sends `text/plain; charset=utf-8`), ≤ 2 MB; a body sent as `application/json` lands byte for byte, valid or not; an empty body writes an empty file | `200 { "kind": "saved", "bytes" }` — parents created, written atomically | `400 { "error": "a folder cannot be written" \| "state.json belongs to the recorder" \| "cost.json belongs to the recorder" \| "not a file" \| path errors }`, `403`, `404 { "error": "run not found" }`, `413 { "error": "document too large" }`, `415 { "error": "only text documents can be edited" }` (extension not `text/*` or `application/json`), `500` |
| E9 | POST | `/api/v1/sessions` | `{ "id", "prompt", "harness"? }` — `id` matches `^[a-z0-9-]+-factory$` and must be a listed pipeline (`factories/<id>/pipeline.json`) whose wrapper skill `.claude/skills/<id>/SKILL.md` exists; `prompt` 1–50 000 characters after trimming; `harness` one of `claude`, `copilot`, `agy`, `codex`, default `claude` (the app always sends `claude`) | `201 { "session", "factoryId", "harness", "prompt", "promptFile", "workDir" }` — `session` is `factory-<id without -factory>-<8 hex>`; the text `/<id> <prompt>` is written to `<PROMPT_DIR>/<session>.prompt` (`0600` in a `0700` folder) and left there; the harness starts in a detached tmux session with cwd `WORK_DIR` and the user options `@harness`, `@factory_id`; the same factory may be started any number of times | `400 { "error": "invalid request body", "details": issues }`, `400 { "error": "malformed JSON body: …" }`, `404 { "error": "no such factory skill on disk", "details": { "available": [ids] } }`, `502 { "error": "the <harness> session exited immediately — …", "details": { "session", "harness" } }` (after `START_GRACE_MS`), `500` |
| E10 | GET | `/api/v1/sessions` | — | `200 { "count", "sessions": [{ "session", "factoryId", "harness", "startedAt", "ageSeconds", "age" }] }` — every tmux session named `factory-*`, oldest first, labels read back from tmux (so a session survives an API restart; a hand-made one shows `"harness": "unknown"`); `{ "count": 0, "sessions": [] }` with no tmux server | `500` |
| E11 | POST | `/api/v1/sessions/stop` | `{ "session" }` — a full session name, or a factory id with or without `-factory` when exactly one of its sessions is live | `200 { "stopped": { "session", "factoryId", "harness", "startedAt", "ageSeconds", "age" } }` | `400`, `404 { "error": "no running factory session named \"…\"", "details": { "running": [session names] } }`, `409 { "error": "\"<id>\" is running n times — stop one by its session name", "details": { "sessions": [...] } }`, `500`; a session whose name does not start with `factory-` is never stopped |
| E12 | GET, HEAD | `/api/v1/scripts/<path>` | — | `200` a text file under `<WORK_DIR>/scripts/` (≤ 1 MB, symlinks followed but kept inside that folder), with its content type | `400` path errors, `404 { "error": "not found" }` (also for a folder or an absent file), `413 { "error": "script too large" }`, `415 { "error": "only text scripts can be read" }`, `500` |
| E13 | GET, HEAD | any path not under `/api` | — | `200` a static asset from `WEB_DIST`, else `WEB_DIST/index.html` (so `/runs/<p>/<r>` reloads into the app) | `503 { "error": "app not built: run npm run build -w web" }` while `index.html` is absent (checked once at startup); any other method → `404 { "error": "not found" }` |
| E14 | any | any other `/api` path (including the editor's former `GET`/`PUT /api/v1/pipelines/:id` and `POST /api/v1/pipelines`) | — | — | `404 { "error": "not found" }` |

Path safety, shared by E5, E7 and E8: a segment that is `.`, `..`, empty, or holds `/` or `\`
(also when percent-encoded) answers `400 invalid path segment`; a malformed escape `400 bad
encoding`; anything that resolves outside the run or knowledge base `403`. No CORS headers
anywhere; `x-powered-by` is off. The API never writes `cost.json` or `state.json`; a `PUT` to
either is refused. Two edges outside the contract: `GET /api/v1/runs/<p>/<r>/` with no document
path answers the generic `404 not found`, and `…/knowledge/{{skillPath}}/` alone answers
`400 empty path`.

Examples:

```
curl -s http://127.0.0.1:3100/api/v1/pipelines | jq -c '[.pipelines[].id]'
curl -s -X PUT -H 'content-type: text/plain' --data 'hello' http://127.0.0.1:3100/api/v1/runs/<pipeline>/<run>/0-verify/input.md
curl -s -X POST -H 'content-type: application/json' --data '{"id":"canonical-factory","prompt":"say hello and exit"}' http://127.0.0.1:3100/api/v1/sessions
curl -s -X POST -H 'content-type: application/json' --data '{"session":"canonical-factory"}' http://127.0.0.1:3100/api/v1/sessions/stop
```

## How it fits together

**Layout.** This folder is an npm workspace root with two packages. `api/` is the Express server:
`src/server.ts` is the one composition root (env → logger → fs and tmux clients → services →
usecases → `createApp` → listen; SIGTERM/SIGINT close only the HTTP server). Each feature under
`api/src/features/{pipelines,runs,scripts,sessions,documents}` (`pipelines` is read-only: the list E2 and knowledge E5) is layered
`routes -> controllers -> usecases -> services`, every layer a function closing over its settings,
with the IO clients under `api/src/clients/{fs,tmux}` and the middleware under
`api/src/shared/middleware` (request log, API key, validation, `no-store`, JSON 404, static app,
document sender, error edge). `web/` is a Vite + React 19 app organised as
`src/features/{runs,sessions}` (components, hooks, `*.schema.ts`, `*.types.ts`, `*.utils.ts`,
and the pure libraries copied from the original tools under `lib/`), `src/shared` (shell, route,
polling, storage, the document viewer, the stylesheets) and `src/adapters/http` (one axios instance
with logging interceptors, one path builder per endpoint, and `studio-api.adapter.ts` with one
function per endpoint the app calls — E2, E5–E12 — each answer parsed with zod). There are no classes on either side.

**How the static app is served.** `npm run build -w web` writes `web/dist` (`index.html` plus hashed
chunks: `react`, `flow`, `zod`, `index`, and a lazy `DocModal` + `markdown` pair that downloads only
when a document is first opened). The API mounts `express.static` on `WEB_DIST` after every
`/api/v1` route and the `/api` JSON 404, and answers any other `GET` or `HEAD` outside `/api` with
`index.html`, so a client-side route such as `/runs/<p>/<r>` survives a reload and a missing
document still answers JSON. The folder is read per request, so a rebuilt `web/dist` is served
without restarting the API (reload the browser to drop the old bundle).

**How the app reaches the API.** Only through relative same-origin paths under `/api/v1/…` built in
`web/src/adapters/http/api-paths.ts` (each document segment URL-encoded once, a trailing `/` kept
for folders). The app has no API URL field, no key field and no configuration fetch; there is no
CORS because there is one origin. Session calls go out as `application/json`;
document saves as `text/plain`. A response that fails its zod schema becomes an `ApiError` and a
message on screen, never partial data.

**How a prompt becomes a tmux session.** `Start` posts `{ id, prompt, harness: "claude" }` (E9).
The usecase checks the id against the pipelines listed on disk that have a wrapper skill, writes `/<id> <prompt>` to
`<PROMPT_DIR>/<session>.prompt` with mode `0600`, builds the harness command by interpolating only
the single-quoted prompt-file path (the prompt text never touches a shell; `$(touch /tmp/pwned)`
arrives in the file as literal text), and runs `tmux new-session -d` with an argument list, cwd
`WORK_DIR`, the name `factory-<id without -factory>-<8 hex>` and the labels `@harness` and
`@factory_id`. After `START_GRACE_MS` it checks the session still exists (`502` if not) and answers
`201`. `GET /api/v1/sessions` reads `tmux list-sessions` and the labels back every time, so the list
is the truth even after an API restart; `Stop` posts the full name and tmux kills that one session.
The Sessions screen shows the `201` row at once and refreshes the list every 10 s.

**How a run's state reaches the screen.** A running factory writes
`run/<pipeline>/<run-id>/state.json` (and `factories-tools/ai-usage` writes `cost.json`). Every
`GET /api/v1/runs` walks `run/` fresh, so a file written after the previous call appears in the
next one with no restart and no snapshot. The Runs screen polls that route every 5 s while the
selected run is `RUNNING` or `PAUSED` and every 30 s otherwise, stops while the tab is hidden and
fetches once when it returns; the payload is checked run by run, so one bad run is dropped and
named in the footer; unchanged runs and pipelines keep their identity across polls so cards do not
flicker and the viewport and selection survive a refresh. Legacy `state.json` shapes, and run snapshots
of `pipeline.json` with string prompts, are upgraded on read (`web/src/features/runs/lib/legacy.ts`). The graph keeps no node positions: it is laid out from the pipeline alone
(`web/src/shared/graph/`), so a pipeline edited on disk is drawn afresh on the next poll.
