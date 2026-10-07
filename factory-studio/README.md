# Factory Studio

One local server and one browser app for the factory pipelines in this repository. The Express API
in `api/` (Node 20, port 3100, loopback only) serves the static React app in `web/` from the same
origin, reads and writes the factory data on disk (`factories/<id>/pipeline.json` — the shared kit, a git submodule — or the project's own `factories.local/<id>/pipeline.json`, with the
factory's own `knowledge/` beside it, the wrapper skills `.claude/skills/<id>/SKILL.md` (links into `factories-skills/` for the kit's),
`run/<pipeline>/<run-id>/`), and starts, lists and stops a Claude harness in a tmux session from a
prompt typed in the browser. Every factory folder is self-contained: its graph, its knowledge and
its extras sit together under `factories/<id>/`, and the graph reaches them through the
`factoryPath` constant (`{{rootPath}}/factories/{{id}}`). It replaces four tools that each needed their own dev
server or process — the pipeline editor (`tools/viz`), the runs dashboard (`tools/state-dashboard`),
the collected-runs browser (`tools/artifact-collector/front`) and the session starter
(`tools/factory-api`) — and imports nothing from them at runtime; they still work on their own.

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
port 5175, proxying `/api` to 3100).

Checks that must pass before a change lands:

```
npm run typecheck -w api
npm run format:check -w api
npm test -w api
npm run typecheck -w web
npm run format:check -w web
```

`npm test -w api` runs the vitest suite over HTTP against a fake tmux and temporary `WORK_DIR`s;
it needs neither tmux nor `claude`. A rebuilt `web/dist` is served without restarting the API
(reload the browser); a rebuilt `api/dist` needs a restart.

### Environment

Every variable has a default; nothing has to be set. Values come from `api/.env` (copy
`api/.env.example`) or the shell. An invalid value stops the server before it listens with one line
`invalid environment: <VARIABLE>: <reason>` and exit code 1.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3100` | TCP port |
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

One address, `http://127.0.0.1:3100/`, one shell with one navigation (Editor, Runs, Sessions), and
three screens. Switching screens changes the URL, and every URL reloads in place.

| URL | Screen |
| --- | --- |
| `/`, `/editor` | **Editor**, redirected to `/editor/<first listed pipeline>`: pick any pipeline skill from the server, see it drawn exactly as the Runs screen draws a run — Start, one card per step (name, agent, model, documents in and out, retry cap), parallel steps stacked in a column, loops and jumps on lanes with event pills, the happy path lit — with the same zoom controls and minimap; View/Edit switch, hover tracing, `Happy path`, `d` for details; pipeline, step and edge inspectors, a Checks panel whose issues select their subject; in Edit mode undo/redo, duplicate, delete, rename by double-click, drag-to-connect, edge reconnect, Wizard and Blocks library (`From API…` lists the server's pipelines); `Save` writes the pipeline back to disk through the API, with `Export JSON`, `Copy` and `PNG` beside it. The Checks panel mirrors the kit's validator (`factories-tools/bin/validate.mjs`): the three anchors with their fixed values, `factoryPath`, placeholders in prompts, paths, constants and hooks, and knowledge that should live under `{{factoryPath}}/knowledge/`. |
| `/editor/<id>` | The Editor on that factory; a refused save shows the API's message and issues under the toolbar with the edits kept; leaving with unsaved edits asks first. `Save` on a pipeline whose `id` is not a factory on disk yet (the Wizard's "Start from nothing", or a loaded file) creates `factories/<id>/pipeline.json`, the wrapper skill `factories-skills/<id>/SKILL.md` and its link `.claude/skills/<id>`, then opens `/editor/<id>`; an id that names another factory is refused on screen so a save never lands on a factory that is not open. |
| `/runs` | **Runs index**: totals, a per-pipeline table (a row filters the run table), a per-run table (a row opens the run), and every run grouped by pipeline with status, day and cost; a run without `state.json` shows `no state`; `Live` indicator, "Updated n s ago" footer and `Refresh`; a run with an invalid `state.json` is dropped and named in the footer while the rest still show. |
| `/runs/<pipelineId>/<runId>[#view=detailed]` | **One run**: the runs sidebar on the left (search box, All / Running / Completed / Failed chips, every run grouped by start day — Today, Yesterday, Oct 3 — with status dot, id, pipeline and cost; the shown run marked and kept in view; rows are links, ArrowUp/Down move between them; `‹` folds it to a rail, remembered in the browser), the run's header line (`All runs`, `pipeline /` id, status, day, duration, cost, `Live`), the status-coloured graph with result pills, legend, `Details`, minimap, the inspector (overview, cost breakdown with a `stale` pill, step pane with attempts, per-step cost and prompt), the collapsible log whose step chips select a node, and the document viewer; refetches every 5 s while the run is `RUNNING`/`PAUSED`, every 30 s otherwise, pauses while the tab is hidden, and keeps viewport and selection across refreshes; `Offline` with the last data when the API stops answering; a stateless run shows the definition graph with "No state.json yet". |
| `/sessions` | **Sessions**: a prompt text area, a factory picker, `Start` (disabled until both are filled) which starts a Claude harness in tmux and shows the new row within about a second; the list of running `factory-*` sessions (session, factory, harness, started, age) refreshed every 10 s, with `Stop` on each row; every refusal (`400`, `404`, `409`, `502`) is a notice on the screen. |
| anything else | the Runs index. |

The document viewer is shared by the Editor (knowledge files of the factory, under
`factories/<id>/knowledge/`; an `input`/`output` path shows the "You are in the editor" notice
with no request) and the Runs screen (run documents, rendered
and raw markdown, text, images, folder listings, missing and error states, relative links opened
on top with `Back`). Only the `input` documents of a `human` step are editable (`Edit`, `Save`,
`Ctrl/Cmd+S`, a confirm before discarding); a document not yet written can be created that way.

## The API

Origin `http://127.0.0.1:3100`. Every `/api/v1` answer carries `Cache-Control: no-store`; every
response carries an `x-request-id` header and one JSON log line (`method`, `path`, `status`, `ms`,
`requestId`). Every error body is `{ error, requestId?, details? }`; nothing ever answers a stack
trace, and a miss under `/api` is JSON, never the app's page. With `API_KEY` set, every `/api/v1`
route may also answer `401 { "error": "unauthorized" }`. `<path>` is one or more URL-encoded
segments; a trailing `/` names a folder. There is no app-wide body parser: JSON (2 MB) is parsed
only on E4, E4b, E9 and E11, raw text (2 MB, any content type) only on E8.

| # | Method | Path | Body | Success | Errors |
| --- | --- | --- | --- | --- | --- |
| E1 | GET | `/health` | — | `200 { "ok": true }`, no key | — |
| E2 | GET | `/api/v1/pipelines` | — | `200 { "pipelines": [{ "id", "path", "pipeline" }] }` — every directory under `<WORK_DIR>/factories.local/` and `<WORK_DIR>/factories/` with a `pipeline.json` (a local id shadows the kit's), read fresh, sorted by id; `path` is `factories.local/<id>/pipeline.json` or `factories/<id>/pipeline.json`; a folder without the file or with one that does not parse is not listed | `500` |
| E3 | GET | `/api/v1/pipelines/:id` | — | `200` the file's bytes unchanged, `application/json; charset=utf-8` | `404 { "error": "pipeline not found" }`, `500` |
| E4 | PUT | `/api/v1/pipelines/:id` | the whole pipeline as JSON, `application/json`, ≤ 2 MB; must have `id`, `constants.rootPath`, `outputDir`, `START`, `steps`, every step `agent`, `prompt`, `on`, and `id` equal to `:id`; unknown keys (for example `hooks`) pass through | `200 { "kind": "saved", "bytes" }` — written atomically as two-space JSON with a trailing newline in the key order received | `400 { "error": "invalid request body", "details": issues }` (also `details: [{ "path": ["id"], "message": "id must equal the id in the path" }]`), `400 { "error": "malformed JSON body: …" }`, `404 { "error": "pipeline not found" }` (a save never creates a factory folder), `413 { "error": "document too large" }`, `500` |
| E4b | POST | `/api/v1/pipelines` | the whole new pipeline as JSON, `application/json`, ≤ 2 MB; everything E4 requires, plus `constants` opening with the anchors at their fixed values (`rootPath: "cwd"`, `skillPath: "."`, `homePath: "~"`) and a `factoryPath` (normally `{{rootPath}}/factories/{{id}}`); the `id` in the body names the factory | `201 { "kind": "created", "id", "path", "skill", "bytes" }` — writes `factories/<id>/pipeline.json` as received (like E4), the wrapper skill `factories-skills/<id>/SKILL.md` and the link `.claude/skills/<id>` → `../../factories-skills/<id>` (what the kit's `install.sh` makes), the skill modelled on `quick-research-factory`'s: the pipeline's `description` in the frontmatter and a body that hands `/<id> <args>` to `any-factory`, so the new factory is listed by E2 and startable by E9 at once; no `knowledge/` folder is made until a file goes in it | `400 { "error": "invalid request body", "details": issues }`, `400 { "error": "malformed JSON body: …" }`, `409 { "error": "\"<id>\" already exists on disk", "details": { "existing": "factories/<id>/pipeline.json" \| "factories.local/<id>/pipeline.json" \| "factories-skills/<id>/SKILL.md" \| ".claude/skills/<id>/SKILL.md" } }` (a create never overwrites either file), `413`, `500` |
| E5 | GET, HEAD | `/api/v1/pipelines/:id/knowledge/<path>` | — | file: `200` bytes with content type (`.md` → `text/markdown`, `.json` → `application/json`, images → `image/*`, code and text → `text/plain`, else `application/octet-stream`) and `Content-Length`; folder: `200 { "kind": "directory", "path", "entries": [{ "name", "type": "file" \| "directory", "size" }] }` (folders first, dotfiles hidden); absent: `200 { "kind": "missing", "path" }`. The path is a knowledge entry as the pipeline spells it: a `{{name}}` naming any other string constant (`{{factoryPath}}`, `{{knowledgePath}}`…) is expanded first, with the built-in `{{id}}`, so `{{factoryPath}}/knowledge/x.md` becomes `{{rootPath}}/factories/<id>/knowledge/x.md`; then a leading `{{rootPath}}/` resolves against `WORK_DIR` (or the pipeline's `constants.rootPath` unless it is `cwd`), a leading `{{skillPath}}/` against the wrapper skill folder `.claude/skills/<id>/`, and a bare path against the folder holding `pipeline.json` (`factories/<id>/`, so `DESIGN.md` or `render/` of a factory open too) | `400 { "error": "invalid path segment" \| "empty path" \| "bad encoding" }`, `403 { "error": "outside the document root" }`, `404 { "error": "pipeline not found" }`, `500` |
| E6 | GET | `/api/v1/runs` | — | `200 { "generatedAt", "pipelines": { <id>: pipeline }, "runs": [{ "runId", "pipelineId", "dir", "hasState", "state", "cost", "hasCost", "pipeline"? }] }` — walks `<WORK_DIR>/run/<pipelineId>/<runId>/` on every call; pipeline id from `state.pipelineName` (or the older `pipeline`) before the folder name; a run whose `state.json` does not parse is skipped (a warning is logged); no `state.json` → `hasState: false, state: null`; unreadable `cost.json` → `cost: null, hasCost: true`; a run's own `pipeline.json` is included as `pipeline` exactly as written — a snapshot from before prompts became line arrays (a string `prompt`, a `systemPrompt`) is served as it is and upgraded by the app, so every old run still draws; sorted newest `createdAt` first, then stateless runs, then by id; unknown fields pass through | `500` |
| E7 | GET, HEAD | `/api/v1/runs/:pipelineId/:runId/<path>` | — | as E5, from `<WORK_DIR>/run/<pipelineId>/<runId>/<path>` | `400`, `403` as E5, `404 { "error": "run not found" }` (also when an id is not a single safe segment), `500` |
| E8 | PUT | `/api/v1/runs/:pipelineId/:runId/<path>` | raw text, any content type (the app sends `text/plain; charset=utf-8`), ≤ 2 MB; a body sent as `application/json` lands byte for byte, valid or not; an empty body writes an empty file | `200 { "kind": "saved", "bytes" }` — parents created, written atomically | `400 { "error": "a folder cannot be written" \| "state.json belongs to the recorder" \| "cost.json belongs to the recorder" \| "not a file" \| path errors }`, `403`, `404 { "error": "run not found" }`, `413 { "error": "document too large" }`, `415 { "error": "only text documents can be edited" }` (extension not `text/*` or `application/json`), `500` |
| E9 | POST | `/api/v1/sessions` | `{ "id", "prompt", "harness"? }` — `id` matches `^[a-z0-9-]+-factory$` and must be a listed pipeline (`factories/<id>/pipeline.json`) whose wrapper skill `.claude/skills/<id>/SKILL.md` exists; `prompt` 1–50 000 characters after trimming; `harness` one of `claude`, `copilot`, `agy`, `codex`, default `claude` (the app always sends `claude`) | `201 { "session", "factoryId", "harness", "prompt", "promptFile", "workDir" }` — `session` is `factory-<id without -factory>-<8 hex>`; the text `/<id> <prompt>` is written to `<PROMPT_DIR>/<session>.prompt` (`0600` in a `0700` folder) and left there; the harness starts in a detached tmux session with cwd `WORK_DIR` and the user options `@harness`, `@factory_id`; the same factory may be started any number of times | `400 { "error": "invalid request body", "details": issues }`, `400 { "error": "malformed JSON body: …" }`, `404 { "error": "no such factory skill on disk", "details": { "available": [ids] } }`, `502 { "error": "the <harness> session exited immediately — …", "details": { "session", "harness" } }` (after `START_GRACE_MS`), `500` |
| E10 | GET | `/api/v1/sessions` | — | `200 { "count", "sessions": [{ "session", "factoryId", "harness", "startedAt", "ageSeconds", "age" }] }` — every tmux session named `factory-*`, oldest first, labels read back from tmux (so a session survives an API restart; a hand-made one shows `"harness": "unknown"`); `{ "count": 0, "sessions": [] }` with no tmux server | `500` |
| E11 | POST | `/api/v1/sessions/stop` | `{ "session" }` — a full session name, or a factory id with or without `-factory` when exactly one of its sessions is live | `200 { "stopped": { "session", "factoryId", "harness", "startedAt", "ageSeconds", "age" } }` | `400`, `404 { "error": "no running factory session named \"…\"", "details": { "running": [session names] } }`, `409 { "error": "\"<id>\" is running n times — stop one by its session name", "details": { "sessions": [...] } }`, `500`; a session whose name does not start with `factory-` is never stopped |
| E12 | GET, HEAD | any path not under `/api` | — | `200` a static asset from `WEB_DIST`, else `WEB_DIST/index.html` (so `/runs/<p>/<r>` reloads into the app) | `503 { "error": "app not built: run npm run build -w web" }` while `index.html` is absent (checked once at startup); any other method → `404 { "error": "not found" }` |
| E13 | any | any other `/api` path | — | — | `404 { "error": "not found" }` |

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
curl -s http://127.0.0.1:3100/api/v1/pipelines/canonical-factory > a.json
curl -s -X PUT -H 'content-type: application/json' --data-binary @a.json http://127.0.0.1:3100/api/v1/pipelines/canonical-factory
curl -s -X POST -H 'content-type: application/json' --data-binary @new.json http://127.0.0.1:3100/api/v1/pipelines
curl -s -X PUT -H 'content-type: text/plain' --data 'hello' http://127.0.0.1:3100/api/v1/runs/<pipeline>/<run>/0-verify/input.md
curl -s -X POST -H 'content-type: application/json' --data '{"id":"canonical-factory","prompt":"say hello and exit"}' http://127.0.0.1:3100/api/v1/sessions
curl -s -X POST -H 'content-type: application/json' --data '{"session":"canonical-factory"}' http://127.0.0.1:3100/api/v1/sessions/stop
```

## How it fits together

**Layout.** This folder is an npm workspace root with two packages. `api/` is the Express server:
`src/server.ts` is the one composition root (env → logger → fs and tmux clients → services →
usecases → `createApp` → listen; SIGTERM/SIGINT close only the HTTP server). Each feature under
`api/src/features/{pipelines,runs,sessions,documents}` is layered
`routes -> controllers -> usecases -> services`, every layer a function closing over its settings,
with the IO clients under `api/src/clients/{fs,tmux}` and the middleware under
`api/src/shared/middleware` (request log, API key, validation, `no-store`, JSON 404, static app,
document sender, error edge). `web/` is a Vite + React 19 app organised as
`src/features/{editor,runs,sessions}` (components, hooks, `*.schema.ts`, `*.types.ts`, `*.utils.ts`,
and the pure libraries copied from the original tools under `lib/`), `src/shared` (shell, route,
polling, storage, the document viewer, the stylesheets) and `src/adapters/http` (one axios instance
with logging interceptors, one path builder per endpoint, and `studio-api.adapter.ts` with exactly
eleven functions for E2–E11 and the create E4b, each answer parsed with zod). There are no classes on either side.

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
CORS because there is one origin. Pipeline saves and session calls go out as `application/json`;
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
of `pipeline.json` with string prompts, are upgraded on read (`web/src/features/runs/lib/legacy.ts`). The editor keeps no node positions: the graph is laid out from the pipeline alone, by the
same code the Runs screen uses (`web/src/shared/graph/`), so every edit lays the graph out again.
