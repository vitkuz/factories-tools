# ai-usage — unified usage & cost tracking for Copilot CLI, Claude Code, Codex CLI and Antigravity CLI

One file-based state that answers, for every run of any of the three harnesses:
how many tokens the whole run used, how much the main agent and every subagent used,
which models, how much provider credit, the estimated list-price USD, and how confident each number is.

```text
~/.claude/projects/**.jsonl ─► Claude adapter  ─┐
~/.codex/sessions/**.jsonl  ─► Codex adapter   ─┼─► UsageEvent (unified) ─► ~/.ai-usage/events.jsonl ─► state.json
~/.copilot/session-store.db ─► Copilot adapter ─┤
~/.gemini/antigravity-cli/conversations/*.db ─► Antigravity adapter ─┘
```

Nothing is scraped from terminals and no CLI needs reconfiguring: every adapter reads the
telemetry the CLI already writes locally, incrementally, with resume cursors.

## Install: one command

```bash
npm run setup                    # install, build, put `ai-usage` on PATH, register the enclosing factory
npm run setup -- /path/to/repo   # explicit factory root
npm run setup -- --no-factory    # per-session tracking only, no pipeline runs
```

Needs Node 20+ and `python3`. After that every command below works from any directory.

## Daily use

```bash
ai-usage ingest                       # pull new telemetry from all three CLIs (safe to run any time, idempotent)
ai-usage report                       # latest runs, all providers
ai-usage report --by customer         # totals per customer
ai-usage report --by provider
ai-usage report --by day --since 2026-09-01
ai-usage report --run 0382a496        # one run in detail: actor tree, models, reconciliation
ai-usage report --provider copilot --json > copilot.json
ai-usage reprice                      # after editing rate cards: recompute every stored estimate
ai-usage ingest --rebuild             # after upgrading the adapters: re-read every source (keeps customers/labels)
ai-usage watch --interval 30          # keep ingesting in the background while you work
```

### Attribute work to customers

Runs are tagged by working directory. Map directories once:

```bash
ai-usage customers add acme  /home/me/acme
ai-usage customers add globex /home/me/globex-backend
ai-usage customers add globex /home/me/globex-frontend
ai-usage report --by customer
```

Anything you run inside those directories (interactive or headless, any of the three CLIs) is attributed automatically.
For one-off work outside a mapped directory, wrap the command:

```bash
ai-usage run --customer acme --label "ticket-481" -- claude -p "refactor the auth module"
ai-usage run --customer acme -- codex exec "add tests"
ai-usage run --customer acme -- copilot -p "explain this repo"
```

`run` ingests before and after the command, tags every run that produced usage in the current
directory during that window, and prints the per-agent breakdown when the command exits.

### Report a run

```text
Run anthropic-claude:0382a496-…
  provider: anthropic-claude   billing mode: subscription   customer: acme
  tokens: 40.49M total = 40.37M in (38.50M cached, 1.85M cache-write) + 118.5K out (21.7K reasoning)
  money: est. list price $35.3472 | billed unknown | certainty local-estimate
  reconciliation: unavailable
  actors:
    main                                    22.48M tok   $22.3055  claude-fable-5-1
      └─ canonical-factory-scout (…d1b6)     3.53M tok    $2.4505  claude-opus-5
        └─ general-purpose (…ad16)           1.04M tok    $0.9336  claude-opus-5
```

`billed unknown` is deliberate: on Claude Max, ChatGPT/Codex and Copilot subscriptions the list price is
what the same run *would* cost on the API, not what you were charged. Only `billedUsd` from billing data is money.

## Pipeline factories: cost per run, per step, per harness

Developer guide for a factory repo, with a paste-able assistant prompt: [docs/factory-guide.md](docs/factory-guide.md).

For agent factories that record runs as `run/<pipeline>/<slug>-<date>/.state.json` (the canonical-factory
state tool, or the older `state.json` shape), register the root once:

```bash
ai-usage factory add ~/my-project
ai-usage factory report                                   # one line per pipeline run
ai-usage factory report --run video-header-cover-2026-09-01-2   # per step: tokens, USD, agent, duration
ai-usage factory report --pipeline canonical-factory --json
```

Every `ai-usage ingest` then refreshes the attribution and writes `<run>/cost.json` next to `.state.json`,
so dashboards that already watch the run folder can show cost.

Attribution is harness-agnostic. The run window and each step's `startedAt`/`completedAt` come from the
factory's own state file; usage is matched to it in this order:

1. **session-id**: the state file records the provider session a step ran in (`steps.<name>.sessionId`,
   and one per pass in `history[].details.sessionId`). That session's whole usage is that step's work —
   exact, not a guess, and the only rule that works for a runner that starts one headless process per
   step, where a step's session has no subagents to recognise. A session id no run recorded is claimed
   by no one; a session id another run recorded is never counted here.
2. **prompt-ref**: the subagent's task prompt names the step's output file (`11-test-frontend/feedback.md`). Strongest of the guesses, and immune to the harness spawning a different agent type than the step declares.
3. **agent+window**: the subagent's name equals the step's `agent` and their time spans overlap.
4. **window**: for harnesses that expose no subagent identity, the harness's own usage during a step window is that step's work.
5. Nested subagents inherit their parent's step. Main-harness usage is reported separately as **orchestrator**. Anything inside the window that matches no step stays **unattributed**; human steps never receive usage.

Rules 2–5 need a session whose cwd is under the factory root; a session the run named is taken wherever
it ran, because some harnesses (Antigravity) record no working directory at all.

**A run that named its own sessions takes nothing else.** No other session is added to it by a time
window, however well it overlaps — that is what kept an unrelated interactive session, open in the same
folder while a run went by, from being billed to it.

## What is in `~/.ai-usage/` (override with `AI_USAGE_HOME`)

| file | content |
|---|---|
| `events.jsonl` | append-only log of normalized `UsageEvent`s (one per model call + provider session snapshots). Idempotent on `eventKey`. |
| `actors.json` | agent hierarchy facts per run (id, name, parent) |
| `runs.json` | run identity: provider session id, cwd, CLI version, billing mode |
| `checkpoints.json` | per-source resume cursors (file byte offsets, last SQLite row id, adapter state) |
| `state.json` | materialized `RunUsageSummary[]` — what `report` reads; rebuilt from the log on every ingest |
| `config.json` | customer ↔ cwd mapping |
| `run-meta.json` | manual customer/label overrides from `ai-usage run` |
| `pricing/*.json` | optional rate-card overrides (same format as `src/pricing/registry/`) |
| `factory-state.json` | per-pipeline-run cost attribution for registered factories (also written as `<run>/cost.json`) |

`state.json` is safe to consume from other tools (dashboards, budgets, invoicing).

## How each provider is read

| | Claude Code | Codex CLI | Copilot CLI | Antigravity CLI |
|---|---|---|---|---|
| usage source | `~/.claude/projects/<proj>/<session>.jsonl` + `<session>/subagents/agent-*.jsonl` | `~/.codex/sessions/**/rollout-*.jsonl` `token_count.last_token_usage` | `~/.copilot/session-store.db` table `assistant_usage_events` | `~/.gemini/antigravity-cli/conversations/<id>.db` table `gen_metadata` (protobuf, decoded by `decode-conversations.py`) |
| main vs subagent | separate transcript per agent; parent = transcript holding the Agent tool result | `session_meta.parent_thread_id` (root thread = main) | `agent_id` / `parent_tool_call_id` columns; names from `session-state/<id>/events.jsonl` | one SQLite file per conversation; a child stores its root id and agent name ("Researcher") |
| nesting | ✅ arbitrary depth | ✅ via parent thread chain | one level (Copilot exposes no deeper links) | ✅ via parent chain |
| dedupe key | `message.id` (Claude writes one record per content block with identical usage) | thread + running-total value | SQLite row id | conversation id + generation index + generation id |
| provider total for reconciliation | `claude -p` result (`modelUsage`, `total_cost_usd`) | `token_count.total_token_usage` | `session.usage_checkpoint.totalNanoAiu` | – |
| provider unit | – | – | `github_ai_credit` = `total_nano_aiu / 1e9`, 1 credit = $0.01 | – |
| replay protection | n/a | first observation baseline (child threads that replay parent history) is excluded; duplicate heartbeats ignored | n/a | n/a |
| billing mode | `~/.claude/.credentials.json` subscriptionType → subscription, `ANTHROPIC_API_KEY` → api-payg | `~/.codex/auth.json` auth_mode chatgpt → subscription | provider-credits | subscription (Google account) |

Token semantics are normalized so `inputTokens` always **includes** cached and cache-write tokens
(Anthropic reports them separately; OpenAI and Copilot include them) and `outputTokens` always **includes** reasoning. Antigravity reports input **excluding** cache reads, so those are added back. `totalTokens = input + output`, never adding cached or reasoning tokens again.

## Pricing

Rate cards live in `src/pricing/registry/*.json`, versioned by `effectiveFrom` and never mutated;
every priced event records its `rateCardId`. Add a file to `~/.ai-usage/pricing/` to override or extend
without touching code. Unknown model → cost `unknown`, tokens still reported.

## Adding another harness

See the interactive explainer at [docs/how-to-track-ai-costs/index.html](../../docs/how-to-track-ai-costs/index.html) in the super repo for the walkthrough. In short: add the provider to `providerSchema`, write `src/adapters/<name>/` with `<name>.types.ts`, `<name>.utils.ts` (raw record → `UsageEvent`), a reader (discover sources, incremental read against the cursor, return events + actor facts + run facts), `create-<name>-usage-adapter.ts`, wire it in `src/cli/container.ts`, add `src/pricing/registry/<name>.json`, a sanitized fixture and a test. The Antigravity adapter (`src/adapters/antigravity/`) is the reference example for a SQLite + protobuf source; the explainer's Gemini walkthrough shows the same recipe for a JSON source.

## Development

```bash
npm test               # vitest against sanitized real fixtures in fixtures/
npm run typecheck
npm run fixtures       # rebuild fixtures from this machine's local sessions
```

## Known limits

- Claude interactive runs have no provider session total locally, so reconciliation is `unavailable`; headless `-p` runs get Anthropic's own estimate.
- Codex `codex exec --json` output is supported through `parseCodexExecJsonl`, but the rollout files are the primary source and cover exec runs too.
- The Copilot adapter shells out to `python3` for read-only SQLite access (Node 20 has no built-in driver).
