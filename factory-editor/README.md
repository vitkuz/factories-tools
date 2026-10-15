# Factory Editor

One local server and one browser app for editing the factory pipelines in this repository. The
Express API in `api/` (Node 20, port 3150, loopback only) serves the static React app in `web/`
from the same origin and reads and writes the factory definitions on disk:
`factories/<id>/pipeline.json` (the shared kit, a git submodule) or the project's own
`factories.local/<id>/pipeline.json`, the factory's own `knowledge/` beside it, the wrapper skills
`.claude/skills/<id>/SKILL.md` (links into `factories-skills/` for the kit's) and the repository's
hook scripts under `scripts/`. Every factory folder is self-contained: its graph, its knowledge and
its extras sit together under `factories/<id>/`, and the graph reaches them through the
`factoryPath` constant (`{{rootPath}}/factories/{{id}}`).

Factory Editor was split out of Factory Studio (`factories-tools/factory-studio`), which keeps the
runs dashboard. This app is the pipeline editor only: no runs, no sessions, no tmux.

## Start it

Install, build and start, all from this folder. `npm run build` builds `web` then `api`;
`npm start` runs `node dist/server.js` in `api/`.

```
cd factories-tools/factory-editor
npm install
npm run build
npm start
```

The server logs one JSON line when it is up
(`"message":"factory-editor-api listening","port":3150,"host":"127.0.0.1"`). Check it:

```
curl -s http://127.0.0.1:3150/health
```

answers `{"ok":true}`. Then open `http://127.0.0.1:3150/`. (A local `api/.env` may set another
`PORT`; the log line names the one in use.)

**Stop it** by the PID that holds the port, never with `pkill node` or `fuser -k` (other tools run
node on other ports):

```
ss -ltnp | grep ':3150 '
kill <pid shown by ss>
ss -ltnp | grep ':3150 '
```

The SIGTERM handler logs `shutting down`, closes the HTTP server and frees the port within about a
second; the npm wrappers exit on their own; the second `ss` prints nothing.

To keep it running after the shell closes, with the log in a file:

```
setsid nohup npm start > <logfile> 2>&1 < /dev/null &
```

Development without a rebuild: `npm run dev:api` (`tsx watch`) plus `npm run dev:web` (Vite on
`EDITOR_WEB_PORT`, proxying `/api` to `PORT`; see [Ports](#ports)).

Checks that must pass before a change lands (from this folder):

```
npm run typecheck
npm run format:check
npm test
npm run build
```

`npm test` runs the vitest suite of `api/` over HTTP against temporary `WORK_DIR`s. A rebuilt
`web/dist` is served without restarting the API (reload the browser); a rebuilt `api/dist` needs a
restart.

### Ports

Every project that carries this submodule can run its own editor at the same time, so the ports
are per project and live in the project's git-ignored `api/.env`, never in the source. The
numbers in this README are the defaults.

```
cp api/.env.example api/.env   # then set PORT and EDITOR_WEB_PORT to ports no other project uses
```

| Variable | Default | Read by | What it is |
| --- | --- | --- | --- |
| `PORT` | `3150` | the API, and the Vite dev server for its `/api` proxy | the API port |
| `EDITOR_WEB_PORT` | `5185` | the Vite dev server only | the dev server's own port (`strictPort`) |

With no `api/.env` both defaults apply; a value in the shell wins over the file. The Vite dev
server reads the same `api/.env` (it has no env file of its own) and refuses to start on a busy
port instead of moving to the next one. Factory Studio (`../factory-studio`) uses its own `PORT` and `STUDIO_WEB_PORT`. To see which ports this checkout uses and
whether it is up:

```
grep -E '^(PORT|EDITOR_WEB_PORT)=' api/.env   # nothing printed: 3150 and 5185
ss -ltnp | grep ':<PORT> '
```

### Environment

Every variable has a default; nothing has to be set. Values come from `api/.env` (copy
`api/.env.example`; `.env` is gitignored) or the shell. Each one is checked by a zod schema at
startup: an invalid value stops the server before it listens with one line
`invalid environment: <VARIABLE>: <reason>` and exit code 1.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3150` | TCP port |
| `EDITOR_WEB_PORT` | `5185` | Vite dev server port, read only by the dev server; see [Ports](#ports) |
| `HOST` | `127.0.0.1` | bind address; loopback unless set on purpose, because the API writes pipeline files and skills |
| `WORK_DIR` | the repository root (two levels above `factories-tools/factory-editor`) | where `factories/` (the kit), `factories.local/`, `.claude/skills/`, `knowledge/` and `scripts/` live |
| `LOG_LEVEL` | `info` | winston level: `error`, `warn`, `info`, `debug` |
| `WEB_DIST` | `factories-tools/factory-editor/web/dist` | the built app served at `/` |
| `API_KEY` | unset | optional; see below |

**The API key.** Unset, every `/api/v1` route is open on loopback and the key middleware is not
attached at all; the listening log line says `"apiKey":"unset"`. To enable it, set
`API_KEY=<16 or more characters>` in `api/.env` (or the shell) and restart: then every `/api/v1`
route requires a matching `x-api-key` header, compared in constant time, answering
`401 { "error": "unauthorized" }` otherwise, and the presented key is never logged. `/health` stays
open either way. **The browser app has no key field and sends no key**, so a set key locks the app
out: the editor would show the `401` as a message. Leave it unset while the app is in use; set it
only for a `curl`-only deployment.

## What you get

One address, `http://127.0.0.1:3150/`, and one screen: the Editor. The pipeline being edited is in
the URL, and every URL reloads in place.

| URL | Screen |
| --- | --- |
| `/`, `/editor` | **Editor**, redirected to `/editor/<first listed pipeline>`: pick any pipeline skill from the server, see it drawn — Start, one card per step (name, agent, model, documents in and out, retry cap), parallel steps stacked in a column, loops and jumps on lanes with event pills, the happy path lit — with the same zoom controls and minimap; View/Edit switch, hover tracing, `Happy path`, `d` for details; pipeline, step and edge inspectors, a Checks panel whose issues select their subject; in Edit mode undo/redo, duplicate, delete, rename by double-click, drag-to-connect, edge reconnect, Wizard and Blocks library (`From API…` lists the server's pipelines); `Save` writes the pipeline back to disk through the API, with `Export JSON`, `Copy` and `PNG` beside it. The Checks panel mirrors the kit's validator (`factories-tools/bin/validate.mjs`): the three anchors with their fixed values, `factoryPath`, placeholders in prompts, paths, constants and hooks, and knowledge that should live under `{{factoryPath}}/knowledge/`. |
| `/editor/<id>` | The Editor on that factory; a refused save shows the API's message and issues under the toolbar with the edits kept; switching to another pipeline with unsaved edits asks first. `Save` on a pipeline whose `id` is not a factory on disk yet (the Wizard's "Start from nothing", or a loaded file) creates `factories/<id>/pipeline.json`, the wrapper skill `factories-skills/<id>/SKILL.md` and its link `.claude/skills/<id>`, then opens `/editor/<id>`; an id that names another factory is refused on screen so a save never lands on a factory that is not open. |
| anything else | the Editor, as `/`. |

The document viewer opens knowledge files of the factory (under `factories/<id>/knowledge/`) and
hook scripts (`scripts/<path>`), rendered and raw markdown, text, images, folder listings, missing
and error states, with relative links opened on top and `Back`. An `input`/`output` path shows the
"You are in the editor" notice with no request: those files are written by a run. The viewer is
read-only.

## The API

Origin `http://127.0.0.1:3150`. Every `/api/v1` answer carries `Cache-Control: no-store`; every
response carries an `x-request-id` header and one JSON log line (`method`, `path`, `status`, `ms`,
`requestId`). Every error body is `{ error, requestId?, details? }`; nothing ever answers a stack
trace, and a miss under `/api` is JSON, never the app's page. With `API_KEY` set, every `/api/v1`
route may also answer `401 { "error": "unauthorized" }`. `<path>` is one or more URL-encoded
segments; a trailing `/` names a folder. There is no app-wide body parser: JSON (2 MB) is parsed
only on E4 and E4b.

| # | Method | Path | Body | Success | Errors |
| --- | --- | --- | --- | --- | --- |
| E1 | GET | `/health` | — | `200 { "ok": true }`, no key | — |
| E2 | GET | `/api/v1/pipelines` | — | `200 { "pipelines": [{ "id", "path", "pipeline" }] }` — every directory under `<WORK_DIR>/factories.local/` and `<WORK_DIR>/factories/` with a `pipeline.json` (a local id shadows the kit's), read fresh, sorted by id; `path` is `factories.local/<id>/pipeline.json` or `factories/<id>/pipeline.json`; a folder without the file or with one that does not parse is not listed | `500` |
| E3 | GET | `/api/v1/pipelines/:id` | — | `200` the file's bytes unchanged, `application/json; charset=utf-8` | `404 { "error": "pipeline not found" }`, `500` |
| E4 | PUT | `/api/v1/pipelines/:id` | the whole pipeline as JSON, `application/json`, ≤ 2 MB; must have `id`, `constants.rootPath`, `outputDir`, `START`, `steps`, every step `agent`, `prompt`, `on`, and `id` equal to `:id`; unknown keys (for example `hooks`) pass through | `200 { "kind": "saved", "bytes" }` — written atomically as two-space JSON with a trailing newline in the key order received | `400 { "error": "invalid request body", "details": issues }` (also `details: [{ "path": ["id"], "message": "id must equal the id in the path" }]`), `400 { "error": "malformed JSON body: …" }`, `404 { "error": "pipeline not found" }` (a save never creates a factory folder), `413 { "error": "document too large" }`, `500` |
| E4b | POST | `/api/v1/pipelines` | the whole new pipeline as JSON, `application/json`, ≤ 2 MB; everything E4 requires, plus `constants` opening with the anchors at their fixed values (`rootPath: "cwd"`, `skillPath: "."`, `homePath: "~"`) and a `factoryPath` (normally `{{rootPath}}/factories/{{id}}`); the `id` in the body names the factory | `201 { "kind": "created", "id", "path", "skill", "bytes" }` — writes `factories/<id>/pipeline.json` as received (like E4), the wrapper skill `factories-skills/<id>/SKILL.md` and the link `.claude/skills/<id>` → `../../factories-skills/<id>` (what the kit's `install.sh` makes), the skill modelled on `quick-research-factory`'s: the pipeline's `description` in the frontmatter and a body that hands `/<id> <args>` to `any-factory`, so the new factory is listed by E2 at once (and `/<id>` runs it from Claude Code); no `knowledge/` folder is made until a file goes in it | `400 { "error": "invalid request body", "details": issues }`, `400 { "error": "malformed JSON body: …" }`, `409 { "error": "\"<id>\" already exists on disk", "details": { "existing": "factories/<id>/pipeline.json" \| "factories.local/<id>/pipeline.json" \| "factories-skills/<id>/SKILL.md" \| ".claude/skills/<id>/SKILL.md" } }` (a create never overwrites either file), `413`, `500` |
| E5 | GET, HEAD | `/api/v1/pipelines/:id/knowledge/<path>` | — | file: `200` bytes with content type (`.md` → `text/markdown`, `.json` → `application/json`, images → `image/*`, code and text → `text/plain`, else `application/octet-stream`) and `Content-Length`; folder: `200 { "kind": "directory", "path", "entries": [{ "name", "type": "file" \| "directory", "size" }] }` (folders first, dotfiles hidden); absent: `200 { "kind": "missing", "path" }`. The path is a knowledge entry as the pipeline spells it: a `{{name}}` naming any other string constant (`{{factoryPath}}`, `{{knowledgePath}}`…) is expanded first, with the built-in `{{id}}`, so `{{factoryPath}}/knowledge/x.md` becomes `{{rootPath}}/factories/<id>/knowledge/x.md`; then a leading `{{rootPath}}/` resolves against `WORK_DIR` (or the pipeline's `constants.rootPath` unless it is `cwd`), a leading `{{skillPath}}/` against the wrapper skill folder `.claude/skills/<id>/`, and a bare path against the folder holding `pipeline.json` (`factories/<id>/`, so `DESIGN.md` or `render/` of a factory open too) | `400 { "error": "invalid path segment" \| "empty path" \| "bad encoding" }`, `403 { "error": "outside the document root" }`, `404 { "error": "pipeline not found" }`, `500` |
| E12 | GET, HEAD | `/api/v1/scripts/<path>` | — | `200` the script's bytes with its content type, as E5 — only a text file (`text/*` or `application/json`) of at most 1 MB under `<WORK_DIR>/scripts/`, confirmed to stay there once symlinks are followed | `400` path errors as E5, `403 { "error": "outside the scripts folder" }`, `404` (also for a folder or a missing file), `413 { "error": "script too large" }`, `415 { "error": "only text scripts can be read" }`, `500` |
| E13 | GET, HEAD | any path not under `/api` | — | `200` a static asset from `WEB_DIST`, else `WEB_DIST/index.html` (so `/editor/<id>` reloads into the app) | `503 { "error": "app not built: run npm run build -w web" }` while `index.html` is absent (checked once at startup); any other method → `404 { "error": "not found" }` |
| E14 | any | any other `/api` path | — | — | `404 { "error": "not found" }` |

Path safety, shared by E5 and E12: a segment that is `.`, `..`, empty, or holds `/` or `\`
(also when percent-encoded) answers `400 invalid path segment`; a malformed escape `400 bad
encoding`; anything that resolves outside the knowledge or scripts base `403`. No CORS headers
anywhere; `x-powered-by` is off. `…/knowledge/{{skillPath}}/` alone answers `400 empty path`.

Examples:

```
curl -s http://127.0.0.1:3150/api/v1/pipelines | jq -c '[.pipelines[].id]'
curl -s http://127.0.0.1:3150/api/v1/pipelines/canonical-factory > a.json
curl -s -X PUT -H 'content-type: application/json' --data-binary @a.json http://127.0.0.1:3150/api/v1/pipelines/canonical-factory
curl -s -X POST -H 'content-type: application/json' --data-binary @new.json http://127.0.0.1:3150/api/v1/pipelines
curl -s http://127.0.0.1:3150/api/v1/scripts/sync.sh
```

## How it fits together

**Layout.** This folder is an npm workspace root with two packages, `@factory-editor/api` and
`@factory-editor/web`. `api/` is the Express server: `src/server.ts` is the one composition root
(env → logger → fs client → services → usecases → `createApp` → listen; SIGTERM/SIGINT close the
HTTP server). Each feature under `api/src/features/{pipelines,documents,scripts}` is layered
`routes -> controllers -> usecases -> services`, every layer a function closing over its settings,
with the IO client under `api/src/clients/fs` and the middleware under `api/src/shared/middleware`
(request log, API key, validation, `no-store`, JSON 404, static app, document sender, error edge).
`web/` is a Vite + React 19 app organised as `src/features/editor` (components, hooks,
`*.schema.ts`, `*.types.ts`, `*.utils.ts`, and the pure libraries under `lib/`), `src/shared`
(shell, route, storage, the graph layout and cards, the document viewer, the stylesheets) and
`src/adapters/http` (one axios instance with logging interceptors, one path builder per endpoint,
and `editor-api.adapter.ts` with one function per endpoint the editor calls — E2, E3, E4, E4b, E5
and E12 — each answer parsed with zod). There are no classes on either side.

**How the static app is served.** `npm run build -w web` writes `web/dist` (`index.html` plus hashed
chunks: `react`, `flow`, `zod`, `index`, and a lazy `DocModal` + `markdown` pair that downloads only
when a document is first opened). The API mounts `express.static` on `WEB_DIST` after every
`/api/v1` route and the `/api` JSON 404, and answers any other `GET` or `HEAD` outside `/api` with
`index.html`, so a client-side route such as `/editor/<id>` survives a reload and a missing
document still answers JSON. The folder is read per request, so a rebuilt `web/dist` is served
without restarting the API (reload the browser to drop the old bundle).

**How the app reaches the API.** Only through relative same-origin paths under `/api/v1/…` built in
`web/src/adapters/http/api-paths.ts` (each document segment URL-encoded once, a trailing `/` kept
for folders). The app has no API URL field, no key field and no configuration fetch; there is no
CORS because there is one origin. Pipeline saves and creates go out as `application/json`. A
response that fails its zod schema becomes an `ApiError` and a message on screen, never partial
data.

**How the graph is drawn.** The editor keeps no node positions: the graph is laid out from the
pipeline alone (`web/src/shared/graph/`), so every edit lays the graph out again. The inspector's
collapsed state is the one thing remembered in the browser (`localStorage` key `editor.inspector`).
