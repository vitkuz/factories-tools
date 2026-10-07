# Cost tracking for pipeline runs

Every pipeline run gets a `cost.json` next to its `.state.json`:

```
run/<pipeline>/<slug>-<date>/
├── .state.json      written by the state tool
└── cost.json        written by ai-usage: tokens and estimated USD per step, per agent, per harness
```

It works for every harness we use: Claude Code, Copilot CLI, Codex CLI and Antigravity CLI.
Nothing changes in how you run a pipeline. The tracker reads the usage logs each CLI already
writes on this machine and matches them to the run by the timestamps in `.state.json` and the
step paths in each subagent's prompt.

## Setup, once per machine

```bash
cd factories-tools/ai-usage && npm run setup      # or: task cost:init
```

That installs, builds, puts the `ai-usage` command on your PATH and registers this repo as a
factory. Needs Node 20+ and `python3`.

## Daily use

```bash
task cost:watch                    # spare terminal, refreshes every 30 s while pipelines run
task cost:report                   # one line per run
task cost:report -- hello-popup    # one run, step by step
task cost:providers                # totals per harness
```

Or run `ai-usage ingest` yourself whenever you want fresh numbers. It is idempotent.

## Reading a run

```
 1 fetch-ticket · ticket-clerk     86K   $0.04   prompt-ref   ← claude:canonical-factory-ticket-clerk
 2 scout-backend · scout           2.97M $2.10   prompt-ref   ← claude:canonical-factory-scout
   orchestrator (main harness)     9.51M $16.40
```

- **est. USD** is the API list price for those tokens. On our subscriptions it is not what was
  billed, so `billedUsd` stays `unknown`. Use it to compare runs and steps.
- **orchestrator** is the main harness itself: reading state, spawning steps, waiting. On Claude it
  runs on the most expensive model and is often the biggest line.
- **attribution** says how the step was matched: `session-id` (the run recorded the provider session
  the step ran in — exact), then the guesses, `prompt-ref` (the subagent's prompt named the step's
  output path), `agent+window`, `window`, or `none`. A run driven by `pipeline-runner` should read
  `session-id` on every agent step; anything weaker there means a session id went unrecorded.
- **unattributed** is usage inside the run window that matched no step. It is never hidden inside
  a step.

## Where the state lives

`~/.ai-usage/` per developer, per machine: the event log, cursors, `state.json` and
`factory-state.json`. Nothing is committed. `run/` is gitignored, so `cost.json` is not either.

## Prompt for your AI assistant

Paste this into Claude Code, Copilot, Codex or Antigravity when setting up a new machine, or when
something in the report looks wrong:

```
This repo tracks the cost of every pipeline run with the `ai-usage` tool in factories-tools/ai-usage
(docs in factories-tools/ai-usage/README.md and factories-tools/ai-usage/docs/factory-guide.md).

Set it up: run `npm run setup` inside factories-tools/ai-usage (or `task cost:init`), then `task cost:report`. Confirm that run/**/cost.json exists for
the latest run and that every completed agent step has a cost line. If a step shows attribution
`none` or usage lands in `unattributed`, read factories-tools/ai-usage/src/features/factory/attribute-run-cost.ts
and explain which rule failed (session-id, prompt-ref, agent+window, window) before changing anything.
Never edit .state.json or cost.json by hand; they are generated.
```

## Adding another harness

Follow `README.md`, section "Adding another harness". The Antigravity adapter in
`factories-tools/ai-usage/src/adapters/antigravity/` is the reference for a SQLite source, the Claude adapter
for JSONL. Then `task cost:init` again.
