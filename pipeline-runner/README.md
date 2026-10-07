# pipeline-runner

Runs a factory `pipeline.json` **deterministically**. The graph decides what runs next — not a
harness that has to remember. One headless agent process per step, routed by code — `claude -p`
by default, or Codex, GitHub Copilot CLI or Antigravity (`agy`) with `--harness`.

It implements `runner.md` as a program: same substitution rules, same routing rules, same
`state.json` the dashboard and the cost hook already read.

```bash
cd factories-tools/pipeline-runner && npm install && npm run build

# from the repository root
node factories-tools/pipeline-runner/bin/pipeline-runner.js resolve research-factory -p topic="..."

node factories-tools/pipeline-runner/bin/pipeline-runner.js run research-factory -p topic="..."

node factories-tools/pipeline-runner/bin/pipeline-runner.js resume run/research-factory/<slug>-<date>
```

| Command | What it does |
|---|---|
| `resolve <pipeline>` | Load + resolve, print the result as JSON. Spawns nothing, creates nothing. `--prompt <step>` prints the exact task message that step's agent would get. |
| `run <pipeline>` | START → END. Creates the run folder, runs hooks, runs every step, writes `state.json` after every transition. |
| `resume <runDir>` | Picks a stopped or failed run back up. Finished steps, edge counts and reported values stand. |

`<pipeline>` is a `pipeline.json`, the folder holding it, or just the factory id — an id resolves
to `factories.local/<id>/pipeline.json`, else `factories/<id>/pipeline.json` (`{{factoryPath}}` is that folder, `{{skillPath}}` the wrapper skill `.claude/skills/<id>/`). Run from the repository
root, or pass `--root`. Exit code is `0` only when the run COMPLETED.

Options for `run` / `resume`: `--harness <claude|codex|copilot|agy>`, `--default-model <id>`,
`--max-step-passes` (fuse, default 12), `--permission-mode`, `--step-timeout <minutes>`, `--json`.
Defaults come from `.env` — see `.env.example`.

> **Permissions.** A headless step cannot be asked for approval, and steps write files and run
> builds, so by default every step is started with the harness's skip-everything flag
> (`claude --dangerously-skip-permissions`) — the way the factories are launched by hand. To run
> tighter, set `PIPELINE_PERMISSION_MODE` or pass `--permission-mode <mode>`. The mode is mapped
> per harness (table below); a mode a harness has no equivalent for is **refused before the run
> starts**, never widened.

## Harnesses

```bash
node factories-tools/pipeline-runner/bin/pipeline-runner.js run <pipeline> --harness codex --default-model gpt-5.6-luna
node factories-tools/pipeline-runner/bin/pipeline-runner.js resume run/<id>/<slug>-<date>      # same harness as the run
```

`--harness` on `run` / `resume` (and on `resolve`, for its agent-profile warnings), default
`PIPELINE_HARNESS` in `.env`, default `claude`. The harness is recorded in `state.json` under
`context.captured.harness`; `resume` uses the recorded one unless `--harness` is given. Binaries:
`CLAUDE_BIN`, `CODEX_BIN`, `COPILOT_BIN`, `AGY_BIN`. Gemini CLI is not supported: it is blocked for
this account (`IneligibleTierError`), so it could not be verified.

The engine is the same for all four. Each harness is one adapter behind `AgentPort`; what a
harness cannot do itself, its adapter bridges:

| | `claude` | `codex` | `copilot` | `agy` |
|---|---|---|---|---|
| Started as | `claude --print` | `codex exec --json` | `copilot --output-format json` | `agy --print=<prompt>` |
| Prompt travels | stdin | stdin (`-`) | stdin (no `-p`) | **argv only**; above 100 kB it is written to `<run>/.harness/<step>.prompt.md` and a short pointer prompt is sent |
| `system` | `--append-system-prompt` | bridged: `## Role` at the top of the prompt | bridged: `## Role` | bridged: `## Role` |
| Event + `report` | `--json-schema` | `--output-schema <file>` (written to `<run>/.harness/`) | **no structured output** — bridged: the adapter appends an instruction to end with a fenced `json` block `{"event": …, "report": {…}}` and parses it; last line as fallback | `--json-schema` |
| Retry in the same session | `--resume <id>` | `exec resume <thread_id>` | `--resume=<id>` | `--conversation <id>` |
| `model` tier | the alias itself (or `CLAUDE_MODELS`) | `CODEX_MODELS` → `-m` | `COPILOT_MODELS` → `--model` | `AGY_MODELS` → `--model` |
| Custom `agent` | `.claude/agents/<a>.md` → `--agent` | none — general-purpose stands in, with the usual note | `.github/agents/<a>.agent.md` (or `~/.copilot/agents`) → `--agent` | `.agents/agents/<a>/agent.md` → `--agent` (location not confirmed, see `harness-research.md`) |
| `bypassPermissions` | `--dangerously-skip-permissions` | `--dangerously-bypass-approvals-and-sandbox` | `--allow-all` | `--dangerously-skip-permissions` |
| `acceptEdits` | `--permission-mode acceptEdits` | `-s workspace-write` | `--allow-tool=write` | `--mode accept-edits` |
| `plan` | `--permission-mode plan` | `-s read-only` | `--allow-all-tools --deny-tool=write --deny-tool=shell` | `--mode plan` |
| `auto` · `manual` · `dontAsk` | by name | refused | refused | refused |
| Own timeout | — | — | — | `--print-timeout`, raised from 5 m to the step timeout |
| Cost in the report | dollars | tokens | premium requests | tokens |
| `transcriptPath` | `~/.claude/projects/…` | left out | left out | left out |

**Models.** `model` in `pipeline.json` (`fable|opus|sonnet|haiku`) is read as a **tier**.
`CODEX_MODELS`, `COPILOT_MODELS`, `AGY_MODELS` (and `CLAUDE_MODELS`) map a tier to a model id as
`tier=model` pairs: `CODEX_MODELS=opus=gpt-6-astra,haiku=gpt-5.6-luna`. They are empty by default:
an unmapped tier passes no model flag, the harness default runs, and the run warns once at load.
`--default-model <id>` (or `PIPELINE_DEFAULT_MODEL`) is the model for steps that name none —
without it such a step runs on the harness default, which on Claude here is the dearest model
(the three-step smoke pipeline cost $1.55 that way, $0.16 with `--default-model haiku`).

**Cost in dollars, on every harness.** The runner only repeats what the harness told it. Dollars for
the other three come from `ai-usage`, which reads each CLI's own telemetry and prices it: add
`bash {{rootPath}}/scripts/ai-usage-ingest.sh {{outputDir}}` to the pipeline's `hooks.after` (every
factory here already has it, and so do the fixtures) and it writes `<run>/cost.json` next to
`state.json`, per step, which is what the dashboard reads. It attributes usage by the `sessionId`
this runner records for every step and every pass, so the figure is the step's own session, not a
guess from timestamps.

**Cost.** Only Claude reports dollars. Tokens and premium requests are carried as `usage` on the
step's `STEP_EVENT` and summed in `context.captured.usage`. The report prints what was reported —
`$0.16`, `121,181 tokens in (59,136 cached), 1,251 out`, `0.99 premium requests` — or
`not reported`; it never prints `$0.00` for a run nobody priced.

**Proving a harness.** `fixtures/harness-smoke` (fan-out, fan-in, a reported value on a
condition, a `system`, both hooks) and `fixtures/harness-retry` (forces the one retry in the
same session) are the two pipelines every adapter was run against. `harness-research.md` has the
verified facts about each CLI and the results.

## How it is put together

Everything is a function; bigger things are made by composing smaller ones. No classes, no
singletons reached for from inside — every effect is injected.

```
src/
├─ cli/                         main entry point
│  ├─ index.ts                  commander wiring, error printing
│  ├─ composition-root.ts       THE one place adapters and usecases are wired together
│  ├─ create-agent-adapter.ts   harness name → AgentPort
│  └─ commands/                 resolve · run · resume — thin, no logic
├─ features/
│  ├─ pipeline/                 load = locate → read → check → resolve → verify
│  │  ├─ pipeline.schema.ts     zod: the shape of pipeline.json
│  │  ├─ pipeline.utils.ts      pure: substitute, slugify, expandVariables, coerce
│  │  ├─ graph.utils.ts         pure: successors, backEdges, reachability, step order
│  │  ├─ services/              locate · read · check-definition · resolve-params ·
│  │  │                         build-variables · resolve-pipeline · verify-workspace
│  │  └─ usecases/load-pipeline.usecase.ts
│  ├─ condition/                the edge-condition language: tokenize → parse → evaluate
│  ├─ harness/                  harness names, permission modes, tier maps, where agents live
│  └─ run/
│     ├─ run.types.ts           the state file + the PORTS (AgentPort, HumanPort, ShellPort)
│     ├─ run.schema.ts          zod: state.json
│     ├─ run-state.utils.ts     pure transitions: (…args) => (state) => state
│     ├─ services/              route-event · select-ready-steps · build-step-prompt ·
│     │                         collect-step-materials · execute-agent-step · execute-human-step ·
│     │                         settle-outcome · drive-run · run-hooks · state-store · build-run-report
│     └─ usecases/run-pipeline.usecase.ts   run + resume
├─ adapters/                    IO boundaries, each `createXAdapter(settings)`
│  ├─ agent-shared/             what every harness adapter shares: the answer schema, the
│  │                            last-line and fenced-json fallbacks, the `## Role` bridge, tier → model
│  ├─ claude/                   AgentPort  → `claude -p` (prompt on stdin, JSON back)
│  ├─ codex/                    AgentPort  → `codex exec --json` (stdin, JSONL back, schema as a file)
│  ├─ copilot/                  AgentPort  → `copilot --output-format json` (stdin, JSONL, no schema)
│  ├─ agy/                      AgentPort  → `agy --print=<prompt>` (argv, one JSON object back)
│  ├─ shell/                    ShellPort  → hooks
│  ├─ terminal/                 HumanPort  → human steps
│  └─ file-system/
└─ shared/                      env · logger · fp (pipe, flow) · errors · process
```

The run feature declares **ports** (what it needs done); adapters implement them. Claude, Codex,
Copilot and agy are four adapters behind `AgentPort`, chosen in one place (`agent:` in
`composition-root.ts`, through `createAgentAdapter`). Another harness is another adapter folder
and one more entry there. The tests swap the agent for a scripted one through the same seam.

### The rules it enforces

**Resolution** (`features/pipeline`) — pure: same file + same context ⇒ same result.

- Map, weakest first: constants → params (a param wins) → `id` / `slug` / `date` → the anchors.
- `rootPath` / `skillPath` / `homePath` become absolute paths (`skillPath` = the wrapper skill folder `.claude/skills/<id>/`; the folder holding `pipeline.json` is the `factoryPath` constant, `{{rootPath}}/factories/{{id}}`). `cwd`, `.`, `~` never get through.
- `slug` = kebab-case of the first declared param (`--slug` pins it). `date` = local `YYYY-MM-DD`.
- Constants may build on other variables; cycles are an error. `outputDir` is resolved last and
  cannot name itself. What the user typed as a param is data — never expanded as a template.
- `input` / `output` hang off the run folder; `knowledge` / `workDir` off the root. All absolute.
- Every problem is reported at once: unknown param, missing required param, wrong type,
  unknown `{{placeholder}}`, unknown target, unreachable step, no path to END, a root with no `.claude/`.
- **Warnings, not errors:** a loop no `max` bounds, a knowledge file that does not exist, a custom
  agent with no profile where the chosen harness keeps them (`.claude/agents`, `.github/agents`, …;
  project or home). The pipeline loads and the run goes on.

**Routing** (`route-event`, `settle-outcome`) — pure: the graph picks the edge.

- A step's edges live under `transitions`: `{ "EVENT": { "target": [...], "max"?, "onMax"?, "condition"? } }`.

- A `condition` must hold or the edge is not taken, and the run stops there. Names resolve from
  what steps reported (latest wins), then params, then constants and built-ins.
- Each traversal is counted per `step:EVENT`. `max: 2` allows two; the third takes `onMax`.
  A spent cap with no `onMax` is a stop sign. Nothing is ever routed around.
- Pending steps the frontier can no longer reach are SKIPPED, with the reason.

**Scheduling** (`select-ready-steps`, `drive-run`)

- Everything ready starts in parallel; steps are settled one at a time, the moment each returns.
- **Fan-in:** a step waits while anything alive is upstream of it — "upstream" measured with
  loop-closing edges removed, so a reviewer that can route back into a builder never deadlocks it.
- After a failure or a refusal nothing new starts; what is running finishes and is recorded.
- **Fuse:** a step that would start more than `--max-step-passes` times fails the run. It never
  invents a route — it exists for loops no `max` bounds (load warns about those).

**Steps** (`execute-agent-step`; the flags named here are the `claude` adapter's — the Harnesses
table has the others)

- Task message order: prompt → revision note (pass ≥ 2: who sent it back, where the feedback is)
  → knowledge (full text, fenced) → inputs (globs expanded; absent files marked) → outputs →
  working directory → events. `system` (its lines joined) goes to `--append-system-prompt`, `model` to `--model`.
- The event comes back through `--json-schema` as an **enum of the step's own events**, plus a
  `report` object for values a condition needs. Fallback: the last line. A miss is asked once
  more in the same session (`--resume`); a second miss fails the step.
- Agents run with cwd = repository root, so project settings, agents and MCP servers apply.
- A custom agent with no profile falls back to general-purpose. A knowledge file that does not exist
  is left out, and the task message says so under `## Knowledge not available` so the agent does not
  go looking. Either way the step runs, the log warns, and the step's `note` in `state.json` records
  what it ran without.
- `sessionId` (and, on Claude, `transcriptPath`) are recorded per step for cost attribution, and
  each pass's own session is kept in the history — a step that looped ran in more than one session.

## Develop

```bash
npm run dev -- resolve research-factory -p topic=x --root ../..
npm test            # 104 tests; the engine runs against a scripted agent and every adapter
                    # against an injected `runProcess` — no harness is ever started
npm run typecheck && npm run format
```

Set `LOG_LEVEL=debug` to see every harness and shell request/response. Logs go to stderr;
stdout carries only the command's result.
