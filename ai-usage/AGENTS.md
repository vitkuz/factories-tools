# ai-usage

Standalone usage and cost tracker for AI coding harnesses: Claude Code, Codex CLI, Copilot CLI,
Antigravity CLI. It reads the logs those CLIs already write locally, normalizes every model call
into one `UsageEvent`, prices it from versioned rate cards, and reports per session, per
subagent, per model, and per pipeline run (`run/<pipeline>/<run>/cost.json`).

It has no dependency on the repository it sits in. Copy the folder anywhere.

```
src/contract/      the one shape every provider maps to (Zod)          — change with care
src/adapters/      one folder per harness; the only code that knows a provider's log format
src/aggregation/   pure functions: dedupe, totals, hierarchy, pricing, reconciliation
src/pricing/       resolve-rate-card.ts + registry/*.json (versioned, never mutated)
src/features/      ingest · report · run wrapper · customers · factory (per-pipeline-run costs)
src/storage/       ~/.ai-usage/* (event log, cursors, state, config)
src/cli/           commander entry + composition root (container.ts)
fixtures/          sanitized real telemetry per provider; tests run against these
docs/              factory-guide.md — using it with pipeline factories
```

## Commands

```
npm run setup [-- <factory-root>]             install, build, link, register the factory (one command)
npm test                                      vitest against fixtures/
ai-usage ingest [--rebuild]                   read new telemetry, refresh state
ai-usage report [--by provider|customer|day] [--run <id>]
ai-usage factory add <root> · factory report [--run <fragment>]
ai-usage reprice                              after editing rate cards
```

## Rules

- Follow the existing style: functional, no classes, explicit types, Zod schemas in `*.schema.ts`,
  types in `*.types.ts`, pure helpers in `*.utils.ts`. Factories close over `settings`; no singletons.
- Adapters only answer "what did the provider report". No pricing, no business logic inside them.
- Never invent a price. Unknown model → unpriced tokens, visible in the report.
- Never present an estimate as billed money. `billedUsd` comes only from billing data.
- Cached tokens ⊆ input, reasoning tokens ⊆ output, `totalTokens = input + output`. Every adapter
  normalizes to that; see `src/contract/usage-event.schema.ts`.
- Idempotency: the same telemetry ingested twice must not change totals. Every event has an
  `eventKey`; pick the most stable id the provider offers.
- Rate cards are versioned by `effectiveFrom`; add a new card, never edit an old one.
- Capture a sanitized fixture before writing an adapter, and add a test that reads it.
- Don't edit `dist/`. Don't hand-edit anything under `~/.ai-usage/`.

## Adding a harness

README.md → "Adding another harness". Reference adapters: `src/adapters/claude/` (append-only
JSONL), `src/adapters/antigravity/` (SQLite + protobuf), `src/adapters/copilot/` (SQLite + event log).
