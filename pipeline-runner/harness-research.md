# Running the pipeline runner on other harnesses — research

Everything below was checked on this machine on 2026-09-17, by reading each CLI's own `--help`
and by making one or two tiny real calls per CLI. Nothing here is from memory or from a web page.
Versions: `claude` (Claude Code), `codex-cli 0.153.4`, `GitHub Copilot CLI 1.0.83`,
`agy 1.1.24` (Google Antigravity CLI), `gemini 0.58.0`.

**Re-checked the same evening while the adapters were built** — `agy` had updated itself to
`1.2.5` in between. Its flags are unchanged; what differed from the first pass is marked
**(corrected)** below, and "What the adapters found" at the end lists everything new.

## Was the runner designed for this? Yes.

The engine never learns which harness runs a step. `features/run/run.types.ts` declares a port:

```ts
export interface AgentPort {
  runAgent: (request: AgentRequest) => Promise<AgentResult>;
}
```

`src/adapters/claude` is one implementation of it (about 220 lines). It is wired in exactly one
place, `src/cli/composition-root.ts` (then `agent: createClaudeAdapter({...})`, now
`agent: createAgentAdapter(harness, {...})`). The tests already swap
it for a scripted agent through the same seam. So another harness is another adapter folder plus a
way to choose one; the loader, resolver, conditions, routing, fan-in, state file and resume do not
change.

What an adapter must do (from `AgentRequest` / `AgentResult`):

| Need | Why |
|---|---|
| Run one prompt headless in a given `cwd` and wait for it | one process per step |
| Take a large prompt (tens of kB: pasted knowledge files) | stdin preferred; argv has a ~128 kB per-argument limit on Linux |
| Auto-approve tools | a headless step has nobody to ask |
| Return the final text | last-line event fallback |
| Return a structured `{event, report}` if the harness can constrain output | "which edge?" without reading prose |
| Return a session id and accept it back | the one retry when the answer names no known event |
| Honour `model`, `systemPrompt`, `agentProfile` when it can | per-step settings from `pipeline.json` |
| Stop on `AbortSignal`, and on timeout | Ctrl-C and `--step-timeout` |

## Capability matrix (verified)

| | Claude Code | Codex | Copilot CLI | Antigravity `agy` | Gemini CLI |
|---|---|---|---|---|---|
| Headless command | `claude --print` | `codex exec` | `copilot -p <text>` | `agy --print='<text>'` | `gemini -p` |
| Prompt on stdin | yes | yes (`-` as the prompt) | yes (no `-p`, pipe stdin) | **no** — `--print=` with stdin gives "empty prompt" | yes |
| Machine-readable output | `--output-format json`, one object | `--json`, JSONL events | `--output-format json`, JSONL events | `--output-format json`, one object | `-o json` |
| Final text is in | `.result` | last `item.completed` with `item.type == "agent_message"`, or the `-o <file>` | the `assistant.message` event, `.data.content` | `.response` | — |
| Structured output | `--json-schema <json>` → `.structured_output` | `--output-schema <FILE>` → the last agent message **is** the JSON | **none** — last-line fallback only | `--json-schema <json or file>` → `.structured_output` | none |
| Session id | `.session_id` | `thread.started` → `.thread_id` | `result` event → `.sessionId` | `.conversation_id` | — |
| Resume | `--resume <id>` | `codex exec resume <id> <prompt>` (keeps `--json`, `--output-schema`, `-m`; **(corrected)** has no `-s`, no `-C`, no `--approve-for-me` — a sandbox goes in as `-c sandbox_mode="workspace-write"`) | `--resume=<id>`, prompt on stdin or `-p <text>` | `--conversation <id> --print='<text>'` | `--resume` |
| Model | `--model` | `-m` | `--model` | `--model` (`agy models` lists ids) | `-m` |
| System prompt | `--append-system-prompt` | none | none | none | none |
| Custom agent | `--agent` (`.claude/agents/<a>.md`) | none | `--agent` (`.github/agents/<a>.agent.md`, `~/.copilot/agents`) | `--agent` — **(corrected)** an unknown name is *silently ignored* and the default agent answers; where profiles live could not be confirmed (see the end) | none |
| Skip approvals | `--dangerously-skip-permissions` | `--dangerously-bypass-approvals-and-sandbox` (or `-s workspace-write` / `danger-full-access`) | `--allow-all` (= `--yolo`); `--allow-all-tools` is *required* in non-interactive mode; add `--no-ask-user` | `--dangerously-skip-permissions` | `--approval-mode yolo` |
| Working directory | process cwd | process cwd or `-C <dir>`; **needs `--skip-git-repo-check`** — this repo is not a git repo | process cwd or `-C <dir>` | process cwd | process cwd |
| Own timeout | none | none | none | **`--print-timeout`, default 5m** — must be raised to the step timeout. **(corrected)** since 1.1.28 an expired print timeout returns the *partial* output and exits 0 with a warning on stderr | none |
| Cost reported | `total_cost_usd` | tokens only (`turn.completed.usage`: `input_tokens`, `cached_input_tokens`, `output_tokens`) | premium requests, fractional (`result.usage.premiumRequests`, 0.33 per call on `gpt-5.4-mini`); **(corrected)** on a resumed session the figure is the session's running total | tokens only (`.usage`) | — |
| Error signal | `is_error`, exit code | `turn.failed` / `error` events, exit code | `result.exitCode`, exit code; **(corrected)** a refused model exits 1 with *no* `result` line at all, the reason only on stderr | `.status` (`"ERROR"`), `.error` (reason first, then a long model list), exit 1 | exit code |
| Status here | works, in use | **works** | **works** | **works** | **blocked**: `IneligibleTierError … migrate to the Antigravity suite` |

Real output, trimmed:

```jsonc
// codex exec --json --output-schema schema.json -
{"type":"thread.started","thread_id":"01a0b086-41d4-7902-8ef8-7ad78cc44cc7"}
{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"{\"event\":\"DONE\",\"report\":{\"n\":1}}"}}
{"type":"turn.completed","usage":{"input_tokens":15505,"output_tokens":30}}

// copilot -p … --output-format json --allow-all-tools --no-ask-user     (43 lines, mostly session.* noise)
{"type":"assistant.message","data":{"content":"1\n\nDONE","model":"claude-sonnet-5", …}}
{"type":"result","sessionId":"c18772f6-54e5-4454-815f-523f5fda13f7","exitCode":0,"usage":{"premiumRequests":1, …}}

// agy --print='…' --output-format json --dangerously-skip-permissions --json-schema '{…}'
{"conversation_id":"2cfed44b-…","status":"SUCCESS","response":"1{…}\n","structured_output":{"event":"DONE","report":{"n":1}},"usage":{"input_tokens":14173, …}}
```

Resume was tested on all three: Codex kept the same `thread_id` and honoured `--output-schema`
again; Copilot and `agy` both answered a question about the previous turn under the same id.

## Gaps an adapter has to bridge

1. **No system-prompt flag (Codex, Copilot, agy).** `runner.md` already names the fallback: put it
   at the very top of the prompt under a `## Role` heading and say it applies for the whole task.
2. **No structured output (Copilot).** The task message already ends with "make the event name,
   alone, the last line", and `eventFromLastLine` already exists. Reported values for conditions
   need one more convention — a final fenced ```` ```json {"event":…,"report":{…}} ``` ```` block
   the adapter parses — or such steps cannot route on a `condition` under Copilot.
3. **Prompt only on argv (agy).** Fine up to ~128 kB. Above that, write the prompt to a file in the
   run folder and send a short prompt that tells the agent to read it.
4. **`model` is a Claude alias** (`fable` / `opus` / `sonnet` / `haiku`) in `pipeline.schema.json`.
   Other harnesses need a per-harness map from tier to model id, in config, not in the pipeline.
   A step with no `model` inherits the harness default everywhere.
5. **Custom agents** live in different places per harness (`.claude/agents`, `.github/agents`, …).
   The load-time check in `verify-workspace` and `resolveAgentProfile` look only under
   `.claude/agents`. Codex has no agent concept: general-purpose stands in, with the usual note.
6. **Cost is not comparable.** Only Claude reports dollars. Record tokens / premium requests where
   there is no dollar figure, and do not print `$0.00` for a run that was not free.
7. **`transcriptPath`** is Claude-specific (`~/.claude/projects/...`). Leave it out elsewhere
   unless the harness has a stable location.
8. **Project context differs.** Claude reads `CLAUDE.md` and `.claude/settings.json`; Codex and
   Copilot read `AGENTS.md`; MCP servers are configured per harness. Copilot loaded 8 MCP servers
   (68k tokens of context, ~10 s start-up) for a one-word answer — consider
   `--disable-builtin-mcps` / `--no-custom-instructions` for mechanical steps.

## The test pipeline

`factories-tools/pipeline-runner/fixtures/harness-smoke/pipeline.json` — three steps, no `model` on any:
`one` ("print 1") and `two` ("print 2") fan out from START; `three` ("print 3") fans in, reads
both files, writes `1 2 3`, reports `inputs`, and its only edge carries `inputs == 2`. It has a
`systemPrompt` on one step and both hooks, so it exercises the role fallback too.

First run on the Claude adapter on 2026-09-17 (`run/harness-smoke/claude-2026-09-17`): COMPLETED;
`one` and `two` started in the same millisecond; `three` started 3 ms after the slower one was
settled; `vars` = `{inputs: 2}`; `3-three/out.txt` = `1 2 3`. It cost $1.55 because no step names
a model and the default here is the most expensive one — see "default model" in the prompt.

```bash
node factories-tools/pipeline-runner/bin/pipeline-runner.js run \
  factories-tools/pipeline-runner/fixtures/harness-smoke/pipeline.json --slug claude
```

## What the adapters found (2026-09-17, after they were built)

`--harness <claude|codex|copilot|agy>` now exists; see "Harnesses" in `README.md` for the matrix
of what each adapter does. Every harness that is logged in here ran the smoke pipeline for real,
on the cheapest model it offers, chosen with `--default-model`:

| Run folder under `run/harness-smoke/` | Harness · model | Result | `one`/`two` started | `three` started | `vars` | `3-three/out.txt` | Cost |
|---|---|---|---|---|---|---|---|
| `codex-2026-09-17` | codex · `gpt-5.6-luna` | COMPLETED | 19:09:41.792 both | 19:10:10.528, once — 3 ms after `one` (the slower) settled | `inputs: 2` | `1 2 3` | 121,181 tokens in (59,136 cached), 1,251 out |
| `copilot-2026-09-17` | copilot · `gpt-5.4-mini` | COMPLETED | 19:11:06.990 both | 19:12:24.474, once — 2 ms after `two` settled | `inputs: 2` | **`2 1 3`** — see below | 0.99 premium requests |
| `agy-2026-09-17` | agy · `gemini-3.8-flash-low` | COMPLETED | 19:11:06.701 both | 19:11:22.064, once — 13 ms after `two` settled | `inputs: 2` | `1 2 3` | 98,497 tokens in, 825 out |
| `claude-haiku-2026-09-17` | claude · `haiku` | COMPLETED | 19:19:13.250 both | 19:19:41.181, once — 3 ms after `one` settled | `inputs: 2` | `1 2 3` | $0.16 (was $1.55 on the default model) |
| `copilot-haiku-2026-09-17` | copilot · `claude-haiku-4.5`, then `gpt-5.4-mini` | FAILED, then **resumed** to COMPLETED | — | once | `inputs: 2` | `1 2 3` | 0.99 premium requests |
| `agy-interrupt-2026-09-17` | agy · `gemini-3.8-flash-low` | **Ctrl-C** 6 s in → FAILED, then **resumed** to COMPLETED | — | once | `inputs: 2` | `1 2 3` | 83,839 tokens in, 750 out |
| `run/harness-retry/copilot-2026-09-17` | copilot · `gpt-5.4-mini` | COMPLETED through the **retry path** | — | — | — | — | 0.66 premium requests (its `state.json` says 0.99: that run is what exposed the session-total double count, fixed since) |

Both hook files exist in every smoke run. Both resumes were started with no `--harness`: the
harness came from `context.captured.harness`. On Copilot `inputs: 2` proves the fenced-JSON
convention, because Copilot has no structured output at all.

What these runs taught, beyond the matrix above:

- **Copilot's `2 1 3`.** Not the runner: `gpt-5.4-mini` fired two `view` calls in parallel, the
  second returned first, and the model concatenated in arrival order although each result carried
  its path. The routing facts (`inputs == 2`, fan-in, hooks) are right; the second Copilot run on
  the same model wrote `1 2 3`. A cheap model is a cheap model.
- **Copilot's model list lies.** `copilot help config` lists `gpt-5-mini` and `claude-haiku-4.5`;
  both are refused for this account (`Model "…" from --model flag is not available.`).
  `gpt-5.4-mini` works. The refusal is free and fails the step with that exact line.
- **The retry path** was forced with `fixtures/harness-retry` (the task tells the agent to withhold
  the event the first time). With `LOG_LEVEL=debug`: call 1 without `--resume`, 1,455 chars; call 2
  with `--resume=<the session id of call 1>`, 133 chars, → `DONE`. It only works on a harness with
  no structured output: a schema-constrained one is forced to name the event the first time.
- **Codex accepts the runner's answer schema as it is**, including `report` with typed
  `additionalProperties`; the last `agent_message` is then exactly the JSON. Codex also prints
  progress `agent_message`s before it, so "the last one" matters.
- **Codex prints `error` events while it reconnects.** The adapter treats a bare `error` as fatal
  only when no `turn.completed` followed; `turn.failed` is always fatal.
- **agy custom agents could not be confirmed.** The binary names `<workspace>/.agents/agents/`
  next to `.agents/skills/<name>/SKILL.md` and its changelog speaks of `agent.md`, so the adapter
  looks for `.agents/agents/<a>/agent.md` (then `<a>.md`; home: `~/.gemini/antigravity-cli/agents`).
  But `agy agents` printed nothing for seven probe locations, and `--agent <probe>` answered as the
  default agent every time — agy also accepts an unknown `--agent` without a word. Until that is
  pinned down, treat a custom agent on agy as "general-purpose with the agent's name attached".
- **agy's prompt-file bridge works.** Forced with `maxArgvPromptBytes: 100` on the built adapter:
  the task (with a secret word and a `## Role`) went to `<run>/.harness/big.prompt.md`, agy got only
  the pointer prompt, and answered `{"event":"DONE","report":{"word":"PLATYPUS-42","role":"terse"}}`.
  Not yet tried with a genuinely large (100 kB+) prompt.
- **agy still reads no stdin**: `agy --print < file` fails with "--print took … as its prompt".
