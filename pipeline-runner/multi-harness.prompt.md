# Prompt — make the pipeline runner work on any harness

Paste everything below the line into a new Claude Code session started from the repository root
(`/path/to/project`).

---

Make `factories-tools/pipeline-runner` run a pipeline on Codex, GitHub Copilot CLI and Google Antigravity
(`agy`) as well as on Claude Code, chosen with one flag. The engine must not change: the runner
was built around a port (`AgentPort` in `src/features/run/run.types.ts`) and Claude is one adapter
behind it. This task adds three more adapters, a way to pick one, and proof that each works. Work
in steps, verify each before the next, and think hard about what is shared and what is not.

## 1. Read before you write

- `factories-tools/pipeline-runner/harness-research.md` — **the facts**: every flag, output shape, session
  id and gap, verified on this machine on 2026-09-17 with real calls. Trust it over memory; if a
  CLI has been updated since, re-check with its `--help` and one tiny call, and fix the document.
- `factories-tools/pipeline-runner/README.md`, then all of `src/adapters/claude/`, `src/cli/`,
  `src/features/run/run.types.ts`, `services/execute-agent-step.service.ts`,
  `services/resolve-agent-profile.service.ts`, `src/features/pipeline/services/verify-workspace.service.ts`,
  `src/shared/config/env.ts`, `src/shared/utils/process.utils.ts`, and `tests/claude-adapter.test.ts`.
- The docs site explains the design: `websites/pipeline-runner-docs` (pages `step-2-architecture`,
  `step-9-running-a-step`, `extending`).

Follow the code style that is there: functional, no classes, curried factories
(`fooFactory(settings) => (request) => result`, composed by `createXAdapter(settings)`), explicit
types on non-primitives, zod on every boundary (`*.schema.ts`), types in `types.ts`, pure helpers
in `*.utils.ts`, every effect injected — `runProcess` is injectable so no test starts a real process.

## 2. What to build

**a. Shared answer parsing.** `eventFromLastLine`, `toReported`, `structuredAnswerSchema` and
`answerSchemaFor` live in the Claude adapter today and every adapter needs them. Move them to
`src/adapters/agent-shared/` (or a better name) and keep the Claude adapter's behaviour and tests
identical. Add there:
- `withRole(systemPrompt, prompt)` — the `runner.md` fallback for a harness with no system-prompt
  flag: the text at the very top under `## Role`, saying it applies for the whole task.
- `answerFromText(text, events)` — for a harness with no structured output: the event from the
  last line, and reported values from a final fenced `json` block `{"event": …, "report": {…}}`
  when there is one. Decide where the instruction to write that block goes; it must reach only
  the harnesses that need it, and the task message built by `buildStepPrompt` must stay
  harness-neutral.

**b. Three adapters**, each a folder like `src/adapters/claude/` (`types.ts`, `*.schema.ts`,
`*.utils.ts`, `operations/run-agent.ts`, `adapter.ts`, `index.ts`), each `= AgentPort`:

| | argv to build | read the answer from |
|---|---|---|
| `codex` | `exec --json --skip-git-repo-check --output-schema <file> [-m] [-C cwd] <approval flags> -`, prompt on stdin; retry is `exec resume <thread_id> … -` | JSONL: `thread.started.thread_id`; last `item.completed` whose `item.type` is `agent_message` — parse its text as the structured answer, fall back to the last line; `turn.failed` / `error` → throw; `turn.completed.usage` → tokens |
| `copilot` | `--output-format json --allow-all --no-ask-user [--model] [--agent] [--resume=<id>]`, prompt on stdin (no `-p`) | JSONL: the last `assistant.message` → `data.content`; `result.sessionId`; `result.exitCode != 0` → throw. No structured output: `answerFromText` |
| `agy` | `--print=<prompt> --output-format json --json-schema <json> --print-timeout <step timeout> [--model] [--agent] [--conversation <id>] --dangerously-skip-permissions` | one object: `structured_output`, `response`, `conversation_id`, `status != "SUCCESS"` or `error` → throw, `usage` → tokens |

Details that matter:
- Codex needs the schema as a **file**: write it into the run folder (or a temp dir) through the
  injected file system, never next to the source.
- `agy` takes the prompt **only on argv** and has its own 5-minute `--print-timeout`. Pass the
  step timeout. When the prompt is larger than ~100 kB, write it to a file under the run folder
  and send a short prompt telling the agent to read that file first.
- Permissions: keep one runner-level setting and map it per harness. `bypassPermissions` (the
  default) → the harness's skip-everything flag; find the closest honest mapping for the other
  modes (`-s workspace-write` for Codex, `--allow-tool` sets for Copilot, `--mode accept-edits`
  for agy) and **refuse with a clear error** where a mode has no equivalent rather than silently
  running wider than asked.
- A failure is a throw with a useful tail of stderr/stdout; a missing event is **not** a throw —
  return without `event` and let `executeAgentStep` do its one retry with `resumeSessionId`.

**c. Choosing the harness.** `--harness <claude|codex|copilot|agy>` on `run` and `resume`, default
from `PIPELINE_HARNESS` in `.env` (default `claude`); per-harness binary overrides
(`CODEX_BIN`, `COPILOT_BIN`, `AGY_BIN`). One factory `createAgentAdapter(harness, settings)` in the
composition root; the `agent:` line there stays the only place an adapter is chosen. Record the
harness in `state.json` under `context.captured.harness` (the schema's one free-form corner — do
not add fields the real `factories/state.schema.json` rejects), and make `resume` use the recorded
harness unless `--harness` is given.

**d. Models.** `model` in `pipeline.json` is a Claude alias (`fable|opus|sonnet|haiku`). Read it as
a **tier**. Add a per-harness tier→model map in config (env or a small `harness.config.json` next
to `.env` — pick one and validate it with zod), with sensible defaults left **empty**: an unmapped
tier means "pass no model flag, the harness default runs", plus one warning at load. Add
`--default-model <id>` for steps that name no model — the smoke pipeline names none, and on Claude
that cost $1.55 for three one-character files because the default model here is the dearest one.

**e. Custom agents.** `verify-workspace` and `resolveAgentProfile` look only in `.claude/agents`.
Make the lookup per harness (`.claude/agents`, `.github/agents`, agy's location — check
`agy agents` and its docs; Codex has none). No profile → general-purpose stands in with the
existing warning and note. Do not break the current behaviour or tests for Claude.

**f. Cost.** `costUsd` stays optional. Where a harness reports tokens or premium requests instead,
carry them on `AgentResult` as an optional `usage` and show them in the report; never print
`$0.00` for a run that was not free. Leave `transcriptPath` out where there is no stable one.

## 3. Prove it

**Unit tests** (no real process, inject `runProcess`), one file per adapter in the style of
`tests/claude-adapter.test.ts`, using the real output samples quoted in `harness-research.md` as
fixtures: argv is right (prompt on stdin / argv, model, agent, resume, approval flags, schema);
the structured answer, the last-line fallback and "no event" are each read correctly; a timeout,
an error event and an empty answer each throw; the role fallback is applied only where there is no
system-prompt flag. Plus tests for the harness factory, the permission mapping (including the
refusals) and the tier map. The existing 57 tests must still pass unchanged in meaning.

**Real runs** of the smoke pipeline on every harness that is logged in on this machine (Claude,
Codex, Copilot, agy were on 2026-09-17; Gemini CLI is blocked for this account — skip it, say so):

```bash
node factories-tools/pipeline-runner/bin/pipeline-runner.js run \
  factories-tools/pipeline-runner/fixtures/harness-smoke/pipeline.json --harness codex --slug codex
```

`fixtures/harness-smoke` is three steps: `one` ("print 1") and `two` ("print 2") fan out from
START, `three` ("print 3") fans in, writes `1 2 3`, reports `inputs`, and its only edge carries
`inputs == 2`. It already passes on Claude (`run/harness-smoke/claude-2026-09-17`). For each
harness, read `state.json` and show: `one` and `two` started together; `three` started only after
the slower of them was settled, once; `vars.inputs == 2` (this is the structured-report path — on
Copilot it proves the fenced-JSON convention); `3-three/out.txt` is `1 2 3`; both hook files
exist; status COMPLETED. Then one run that forces the retry path on a real harness if you can do
it cheaply, and one `resume` after Ctrl-C.

Use the cheapest model each harness offers for these runs. They cost real money/quota: keep them
to the smoke pipeline, and say what each cost.

## 4. Finish

- `npm run typecheck`, `npm test`, `npm run format`, `npm run build` — all clean.
- Update `factories-tools/pipeline-runner/README.md` (a "Harnesses" section: the flag, the env, the matrix of
  what each adapter supports and how each gap is bridged), `.env.example`, and
  `examples/README.md` (one line: `--harness` works after `run`).
- Update the docs site `websites/pipeline-runner-docs`: the `extending` page now has three real
  adapters to point at instead of only the test double; `cli-reference` gets `--harness`,
  `--default-model` and the new env; `step-9-running-a-step` gets a short section on the shared
  answer parsing. Every titled code block must still be a verbatim copy:
  `npm run check:snippets` there must report 0 stale. Rebuild the site.
- Fix `harness-research.md` wherever reality differed from it.
- Do not commit.

Report at the end: which harnesses pass the smoke pipeline (with the evidence lines from each
`state.json` and the cost), which gaps you bridged and how, what you could not make work and why,
and anything left open — in particular anything that works on the smoke pipeline but would not
survive a real factory (large prompts on agy, conditions on Copilot, MCP servers and project
instructions that differ per harness).
