# Prompt — build the pipeline-runner docs site

Paste everything below the line into a new Claude Code session started from the repository root
(`/path/to/project`).

---

Build a documentation website for the tool at `factories-tools/pipeline-runner`. The site explains, step by
step, how the runner was built and how it works, for an engineer who wants to understand it well
enough to extend it. Work in steps, verify each one before the next, and think hard about the
teaching order.

## 1. Start from the template — do not build from scratch

Copy `websites/ai-dark-software-factory` to `websites/pipeline-runner-docs` (skip `node_modules`,
`dist`, `package-lock.json`), then `npm install`. It is Vite + React 19 + TypeScript: pages are
markdown files with front matter in `src/content/pages/*.md`, loaded by
`src/content/content.manifest.ts`, validated by `src/content/content.schema.ts`, rendered by
`src/features/page/MarkdownProse.tsx` and `BlockRenderer.tsx`. Keep its design, tokens, layout,
sidebar, search, theme toggle and the `:::` blocks (`lede`, `callout`) as they are.

Change only what this site needs:
- the site name in `index.html`, `package.json` and `src/shared/components/Header.tsx`
  → "Pipeline Runner";
- `NAV_GROUPS` in `content.schema.ts` → `['Start here', 'How it was built', 'Reference']`, and
  loosen the `report` field (it is research-specific; make it optional free text or drop it);
- delete the old pages; the research-only blocks (`finding`, `verdict`, `sources`) may stay in the
  code unused — do not spend time removing them;
- the two additions in section 3.

## 2. Read the source before you write a word

The content comes from the code, not from memory. Read all of it first:
`factories-tools/pipeline-runner/README.md`, everything under `factories-tools/pipeline-runner/src`, the tests under
`factories-tools/pipeline-runner/tests`, and the contract it implements:
`.claude/skills/any-factory/runner.md`, `factories/pipeline.schema.json` and `factories/state.schema.json`,
plus the factory's own `factories/build-docs-site-factory/pipeline.json`. Every code snippet on the site must be copied from a real file, with
its path shown above it (`src/features/run/services/route-event.service.ts`). Add nothing the code
does not do. If you shorten a snippet, mark the cut with `// …`.

## 3. Two additions to the template

**Code highlighting.** `src/shared/components/CodeBlock.tsx` renders plain `<pre>` today. Add
syntax highlighting with **Shiki** (`shiki`, fine-grained bundle: only `typescript`, `tsx`, `json`,
`bash`, `markdown`). Use a dual theme (`github-light` /
`github-dark`) driven by CSS variables so it follows the existing theme toggle with no re-render.
Keep the copy button. Support an optional title on a fence — ```` ```ts title="src/cli/index.ts" ````
— rendered as a filename bar above the block. Load the highlighter lazily so the first paint does
not wait for it; show the unhighlighted code until it is ready.

**Mermaid diagrams.** A fenced block with language `mermaid` renders as a diagram, not as code.
Create `src/shared/components/MermaidDiagram.tsx`: import `mermaid` dynamically (it is large — it
must be its own chunk, loaded only on pages that have a diagram), render to SVG, re-render when
the theme changes using mermaid's `base` theme fed from the site's own CSS tokens (read
`tokens.css`; diagrams must look native in light and dark). Give each diagram a caption from an
optional `title="…"` on the fence, make it horizontally scrollable on phones, and fall back to the
source as a code block if rendering throws. Wire both into the `pre`/`code` components in
`MarkdownProse.tsx`.

Follow the template's code style: functional React, no classes, explicit types on non-primitives,
zod on boundaries, small components.

## 4. The pages

Tell it as a build story — each page is one step, says what problem that step solved, shows the
real code, and ends with how it was verified. Suggested outline (adjust after reading the code):

**Start here**
1. `index` — what the runner is, the problem ("the main harness had to remember the next step"),
   the three commands, and one diagram of the whole thing: CLI → loadPipeline → runPipeline →
   adapters.
2. `quick-start` — install, build, `resolve`, `resolve --prompt <step>`, `run`, `resume`, the
   `.env` settings, the permission-mode note, exit codes.

**How it was built**
3. `step-1-understand-the-contract` — what `runner.md` asks of a runner: substitution order, the
   three path anchors, built-ins, routing (`condition` → count → `max` → `onMax`), fan-in, skipped
   branches, hooks, the state file. Diagram: the `build-docs-site-factory` graph as a flowchart.
4. `step-2-architecture` — composition as the main idea: utils → services → usecases → adapters →
   composition root; ports declared by the feature, implemented by adapters; curried factories;
   `pipe` and `flow`. Diagram: layer/dependency graph. Show `composition-root.ts` in full.
5. `step-3-the-loader` — `locate → read → check`: the zod schema, `parsePipeline`, the `Check`
   list in `check-definition.service.ts`, errors vs warnings, all issues reported at once.
6. `step-4-the-resolver` — `resolveParams`, `buildVariables` (the two-pass expansion, why params
   are data and never templates, cycle detection), `resolveStep` with its two `pipe`s, and how
   they compose into `loadPipeline`. Diagram: the variable-resolution order. Include a real
   before/after of one step from `pipeline.json`.
7. `step-5-conditions` — the small language: tokenizer, recursive-descent parser with the grammar,
   evaluator, and why it throws instead of guessing.
8. `step-6-state-as-transitions` — `RunState` is the state file; every change is
   `(…args) => (state) => state` composed with `flow`; `activate` / `release` and the requeue case.
   Diagram: a step's status state machine.
9. `step-7-routing-and-scheduling` — `routeEvent`, `settleOutcome`, `selectReadySteps`. Explain
   fan-in with the back-edge/DAG argument and why it cannot deadlock. Diagrams: a sequence diagram
   of plan ∥ design → build, and the REVISE loop with `max`/`onMax`.
10. `step-8-the-drive-loop` — `driveRun`: start ready → race → settle → persist → again; halting,
    the fuse, abort, resume. Diagram: the loop as a flowchart.
11. `step-9-running-a-step` — prompt assembly order, fenced knowledge, absent inputs, revision
    pass, human steps; then the Claude adapter: argv, prompt on stdin, `--json-schema` with the
    events as an enum, last-line fallback, one retry via `--resume`, transcript path.
    Diagram: sequence of runner ↔ adapter ↔ `claude -p`.
12. `step-10-proving-it` — the scripted agent and in-memory file system, what the 51 tests cover,
    the byte-for-byte determinism test, validation against the real `state.schema.json`, and the
    real smoke run (4 steps, haiku, fan-in + condition + REVISE loop).

**Reference**
13. `cli-reference`, 14. `pipeline-json-reference` (fields and rules, as tables),
15. `state-file-reference`, 16. `extending` — writing another `AgentPort` adapter and swapping it
    in the composition root, adding a `Check`, adding a command.

Use `::: lede` at the top of every page and `::: callout` for rules worth remembering. Aim for at
least one mermaid diagram on every "How it was built" page, and keep diagrams small enough to read
on a phone.

## 5. Verify, then hand over

- `npm run typecheck`, `npm run build`, `npm run format` — all clean.
- Serve the production build (`npm run preview`), open every page in the browser (Playwright MCP)
  at desktop and phone width, in light and dark: every diagram renders, every code block is
  highlighted, no console errors, search finds the new pages, no horizontal page scroll on phone.
  Check that the mermaid chunk is not in the entry bundle (look at the build output).
- Write `websites/pipeline-runner-docs/README.md`: how to install, build, preview, add a page, add
  a diagram, and which files differ from the template (so a shell fix can go to the template first).
- Stop the preview server you started. Do not commit.

Report at the end: the URL you verified on, the page list, what you changed beyond text, and
anything left open.
