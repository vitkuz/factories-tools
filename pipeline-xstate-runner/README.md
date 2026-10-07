# pipeline-xstate-runner

Runs any factory `pipeline.json` as an [XState v5](https://stately.ai/docs/xstate) actor system,
with no supervising LLM session: code decides every routing step, each step is one headless
subagent started through a harness client, and the whole run lifecycle is an explicit,
inspectable state machine. It reads the kit's contracts and writes the kit's contracts; it
imports nothing from the other tools.

```text
factories/<id>/pipeline.json            ← contract in  (factories/pipeline.schema.json)
        ↓  validate   own Zod twin + the graph rules       (learned from tools/validation)
        ↓  resolve    params, constants, anchors, {{names}} (rules from skills/any-factory/runner.md)
   Run machine (XState v5)              ← one per run, the same shape for every pipeline
        │  context: the state.json twin — frontier, edge counts, reported values, step records
        │  guards:  named and pure — the four ways a route is refused, fan-in readiness, the fuse
        ├── spawns one Step actor per step pass        running = invoke harness.runStep(...)
        ├── spawns one Human-step actor per human pass  asking  = invoke human.ask(...)
        └── invokes hook actors (hooks.before / hooks.after)
        ↓
   <runDir>/state.json    ← contract out (factories/state.schema.json, unchanged)
   <runDir>/events.jsonl  ← own: every event the run machine received, in order (replay)
   <runDir>/snapshot.json ← own: the persisted run machine (resume, answer)
```

It ships bundled as `<factories-tools>/bin/xstate-runner.mjs` (`factories-tools/bin/xstate-runner.mjs` in a project),
so a consumer needs node 20 and nothing else. Only the `claude` harness needs `claude` on PATH.

## Use

Run from the project root (the folder holding `.claude/`):

```sh
X=factories-tools/bin/xstate-runner.mjs
node $X validate quick-research-factory              # the kit's verdict and exit codes
node $X resolve quick-research-factory -p topic="…"  # the resolved pipeline; --prompt <step> for its task message
node $X run quick-research-factory -p topic="…" --default-model haiku
node $X resume run/quick-research-factory/<slug>-<date>
node $X answer run/<id>/<slug>-<date> <step> APPROVE --note "…"
node $X show run/<id>/<slug>-<date>
node $X replay run/<id>/<slug>-<date>
node $X compile quick-research-factory               # a visual statechart, never executed
node $X --list-guards                                # every named guard of every machine
node $X --list-harnesses                             # every installed harness and its capabilities
```

`<pipeline>` is an id (`factories.local/<id>` first, then `factories/<id>`), a folder or a file.

| Option | Meaning |
|---|---|
| `--harness <name>` | `claude` (default; `PIPELINE_HARNESS`) or `scripted` (a fake: `--script <answers.json>`) |
| `--default-model <id>` | the model for steps that name none (`PIPELINE_DEFAULT_MODEL`) |
| `--permission-mode <mode>` | how headless steps answer permission prompts (`PIPELINE_PERMISSION_MODE`, default `bypassPermissions`); a harness without the mode is refused, never widened |
| `--step-timeout <minutes>` | kill a step that runs longer (`STEP_TIMEOUT_MINUTES`, default 90) |
| `--max-step-passes <n>` | the fuse: fail the run when one step would start more often than this (default 12) |
| `--human terminal\|park` | ask at the terminal, or park the run and exit 3 (default: terminal with a TTY, else park) |
| `--inspect terminal\|jsonl` | stream every machine event to stderr, or to `./inspect.jsonl` |
| `--json`, `--root <dir>` | the result as JSON; what `{{rootPath}}` resolves to |

Exit codes: 0 COMPLETED · 1 FAILED, interrupted, or an error · 2 refused (nothing written) · 3 parked for a person.
Logs go to stderr (`LOG_LEVEL=debug`); stdout carries only the command's result.

## The machines

`src/features/machines/run.machine.ts` — one per run:

```text
validating ──► resolving ──► opening ──► hooksBefore ──► running ──► hooksAfter ──► completed
    │              │                         │              │ ▲                 └──► failed
    └──────────────┴──► failed (never opened)└──► hooksAfter│ │
                                                            │ └── parked   (a human step, nobody to ask; `answer` resumes)
                                                            └──── stopped  (Ctrl-C; `resume` goes on)
```

Inside `running` a `STEP.DONE` goes through the named guards `outcomeIsStale`, `eventIsUnknown`,
`conditionIsInvalid`, `fallbackIsMissing`, `capIsSpent` (the refusals of the recorder, in its
order), then `routeEvent` → `skipStranded` → `spawnReadySteps`. Eventless transitions close the
run: `runIsInterrupted` → stopped, `runIsHalted` → FAILED, `runIsFinished` → COMPLETED,
`runIsStalled` → FAILED.

`step.machine.ts` — one spawned actor per agent step pass:

```text
preparing ──► running ──► validatingAnswer ──► collectingOutputs ──► stamping ──► done
                ▲              │ (no known event, a session id, first call)   ├──► failed
                └── retrying ◄─┘                                               ├──► timedOut  (after stepTimeout)
any ──CANCEL──────────────────────────────────────────────────────────────────►└──► cancelled
```

`human-step.machine.ts` — one per human step pass: `preparing → asking → stamping → recording →
collectingOutputs → done | parked | failed | cancelled`.

Rules the machines keep:

- **Actions only assign.** `machines.actions.ts` holds pure reducers (`context → context`); the
  machines wrap them in `assign`. The one composite action, `spawnReadySteps`, enqueues an assign
  and the `spawnChild` calls; `cancelRunningSteps` enqueues `sendTo` the running children.
- **Guards are named, pure and described.** `machines.guards.ts`, `defineGuard` as in run-state;
  `--list-guards` prints them.
- **Every event carries `at`.** The clock is read where the event is born (a client, an actor's
  `stamping` state), never inside a machine, so `replay` re-feeds `events.jsonl` into a machine
  with inert actors and rebuilds `state.json` byte for byte.
- **Side effects are actors** backed by `RunEffects` (`machines.types.ts`), wired from the
  injected clients in `src/features/run/services/create-run-effects.service.ts`.

## Harness clients (the plug-in point)

```ts
interface HarnessClient {
  name: string;
  capabilities: HarnessCapabilities; // systemPrompt, structuredOutput, resume, customAgents, costUsd, permissionModes
  runStep: (request: AgentRequest) => (signal: AbortSignal) => Promise<AgentResult>;
}
```

One folder per harness under `src/clients/harness/<name>/`, registered in one place:
`createHarnesses` in `src/cli/composition-root.ts`. v1 ships `claude` (`claude -p`, the prompt on
stdin, `--json-schema` for the `{event, report}` answer, `--append-system-prompt`, `--resume` for
the one retry, `--model`, `--agent`, the permission mode) and `scripted` (a fake for tests, dry
runs and replay). The harness is recorded in `state.json` (`context.captured.harness`) and
`resume` reuses it unless `--harness` says otherwise.

## Files a run writes

- `state.json` — the contract, atomically (temp file + rename), the recorder's written form:
  fixed key order, sorted maps, nanosecond timestamps that never go backwards across a resume.
  This runner adds to it only inside the contract's free corners: `context.captured`
  (`runner`, `harness`, `costUsd`, `usage`), `steps.<name>.sessionId` / `transcriptPath`, and
  per-pass `sessionId` / `costUsd` / `usage` / `durationMs` in `STEP_EVENT` details.
- `events.jsonl` — `{seq, event}` per line, every event the run machine received from outside
  itself (step outcomes, actor results, RESUME, HUMAN.ANSWER, CANCEL).
- `snapshot.json` — `{runner, machineVersion, snapshot}`; a snapshot of another `machineVersion`
  is refused. In-flight step actors are never restored: `resume` re-runs them as a new pass.

A run never writes inside `factories/`. A run folder that already holds a `state.json` is never
reused (`resume` it, or change a param so the slug differs).

## Code layout

```text
../../bin/xstate-runner.mjs      the committed esbuild bundle of src/cli/index.ts (npm run bundle)
src/
├─ cli/                          entry point: commander program → handlers → usecases; composition-root (clients wired here only)
├─ clients/                      IO boundaries, injected, never imported from deep inside
│  ├─ harness/{claude,scripted}/ one folder per harness, plus shared/ (the answer schema and parsers)
│  ├─ human/{terminal,park}/     ask at a terminal, or park the run
│  └─ clock/ ids/ file-system/ process/ shell/
├─ features/
│  ├─ pipeline/                  Zod twin, graph utils, the 13 + 2 copied rules, locate/load/validate/resolve services
│  ├─ routing/                   condition language, resolve-edge, readiness, stranded steps (copied from run-state)
│  ├─ state/                     state.json twin, serializer, transitions, read/write services
│  ├─ prompt/                    the task message (runner.md order), materials, outputs, the decision file
│  ├─ machines/                  run.machine, step.machine, human-step.machine, guards (named), actions (pure), types
│  ├─ persistence/               state.json, snapshot.json, events.jsonl writers and readers
│  ├─ inspect/                   sinks: terminal, jsonl
│  ├─ run/                       usecases (run, resume, answer, show, replay, validate, resolve, compile), the actor driver, effects
│  └─ report/                    the run report, --list-guards, --list-harnesses, the validation report
└─ shared/                       env (dotenv + zod), logger (winston, stderr), fp, result, paths
fixtures/                        the pipelines it is tested against (and run for real: hello-*)
tests/unit                       routing, conditions, state, pipeline, prompt, guards, the machines on the scripted harness, the bundle
tests/contract                   black-box: validate.mjs and state.mjs as external processes, the schema files
```

## Learned from

No import, no build dependency; every copy carries a `// Learned from <path>` header.

| Topic | Source | How it entered |
|---|---|---|
| Field meanings, substitution, anchors, task-message order, human steps, report | `factories-skills/any-factory/runner.md` | re-implemented |
| Zod shape of `pipeline.json`; the graph rules; `--list-rules` text | `factories-tools/validation/src/` | copied (`pipeline.schema.ts`, `rules/`) |
| Condition language; `max`/`onMax`/`EDGE_CAPPED`; forward-edge fan-in; stranded steps | `factories-tools/run-state/src/features/routing/` | copied |
| Named guards that refuse with a reason; `defineGuard`; `--list-guards` | `factories-tools/run-state/src/features/guards/` | pattern re-used as XState named guards |
| The state transitions a run records, in the recorder's words | `factories-tools/run-state/src/features/commands/` | re-implemented as pure reducers |
| `state.json` serializer: key order, sorted maps, nanosecond monotonic clock, atomic write | `factories-tools/run-state/src/features/state/`, `clients/clock`, `clients/file-system` | copied |
| Parity testing: normalise timestamps, ids, runner-only fields | run-state's tests | re-used as contract tests |
| The Claude adapter: flags, stdin prompt, structured answer, retry in the same session, `## Role` bridge | `factories-tools/pipeline-runner/src/adapters/{claude,agent-shared}` | copied |
| The task message builder, materials, outputs, the decision file, the run report | `factories-tools/pipeline-runner/src/features/run/services/` | copied |
| Permission modes, the hook runner, the process runner, the terminal | `factories-tools/pipeline-runner/src/{features/harness,adapters/shell,adapters/terminal,shared/utils/process.utils}` | copied |
| Smoke fixtures | `factories-tools/pipeline-runner/fixtures/harness-{smoke,retry}` | copied into `fixtures/` |
| A JSON-schema checker for tests | `factories-tools/pipeline-runner/tests/support/json-schema.mjs` | copied into `tests/support/` |

## Develop

```sh
npm install
npm run check        # typecheck + format:check + test
npm run bundle       # writes ../../bin/xstate-runner.mjs; tests/unit/bundle.test.ts fails while it is stale
npm run dev -- run fixtures/hello-sequential --harness scripted --script answers.json
```

Add a harness: `src/clients/harness/<name>/` (client, schema, utils, types, index) implementing
`HarnessClient`, one line in `createHarnesses`, a smoke run on its cheapest model. Nothing else
changes. Add a guard: one `defineGuard` entry in `machines.guards.ts`, one reference in a
machine; `--list-guards` picks it up. Change what a run records: one pure reducer in
`machines.actions.ts`; the contract tests say whether the recorder still agrees.
