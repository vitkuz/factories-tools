# Graph readability — plan

Stage 2. Builds on `scout.md`. Nothing here is implemented yet. Paths relative to
`factories-tools/` unless absolute; the code style of `shared/graph` applies (pure functions,
curried where they already are, no classes, explicit types for non-primitives, colours only as
CSS classes).

## 1. Definition of "wave"

**wave(step) = the longest path from START over the forward graph**, where the forward graph is
exactly the recorder's (`pipeline-state/src/features/pipeline/graph.utils.ts:19-27`):

- every route **without** `max` contributes its `target[]`;
- every route **with** `max` contributes only its `onMax[]` (the exit); its `target[]` is the
  loop, i.e. the **back edge**;
- START = wave 0, the entry steps = wave 1, END = max wave + 1; a step unreachable from START
  gets wave 1 (as today).

Why this and not the alternatives:

- *The recorder's `state.steps[*].order`* is a BFS/shortest-path layer. It agrees with the above
  for klevrs-kp-factory on all 25 steps, but on a shortcut (`research → final` via `SKIP`) it pulls
  the target left and a forward edge would point backwards. It is also absent for a run that has no
  `state.json` yet, is `0` in older state files, and the schema says it should be `0` for graph
  runs — so the client cannot rely on it. Computing on the client keeps a stateless pipeline and a
  run identical, which is what the "No state.json yet" view needs anyway.
- *Today's DFS back-edge detection* is order dependent (scout §2.1) and is the cause of the wrong
  columns. Capped routes are the kit's own definition of a loop (validator `loops-capped`,
  recorder `forwardNeighbours`), so using them is not a heuristic, it is the semantics.
- *Fallback*: a pipeline with an uncapped loop (the validator only warns) still has a cycle in the
  forward graph. The residual cycle is broken as today — DFS from START over the forward graph,
  an edge into a step still on the stack is a back edge — so nothing can throw and such pipelines
  draw as they do now. Test-covered.

The runtime `history` is not used for waves: the run's `WAVE_START` appears once and steps do not
carry a wave in the log. "Started together" is therefore a static property of the definition, which
is also what the user described ("each column = the cards of one wave").

## 2. Layout

**Custom, keep `shared/graph/layout.ts`; no dagre/elk.** Reasons: the layout is copied into the
Editor and into factory-diagram, which renders SVG without a DOM — a layout library would have to
be added three times and its results snapshotted; the current code already does columns, stacks and
lanes deterministically; the fix is in the ranking and in what is drawn, not in the placement
engine.

Changes:

1. `rank.ts` — `rankPipeline` keeps its signature and `PipelineRanks` shape (`rank`, `back`,
   `order`) so `layout.ts`, `PlainView.tsx` and the diagram port need no interface change:
   - `back` = every capped route's `(source, target)` key, plus the residual DFS back edges of the
     forward graph;
   - `rank` = longest path over the forward graph (the existing `rankOf` recursion, fed the new
     `preds`);
   - `order` = steps sorted by (wave, position in the wave). Position in a wave: the **happy-path
     card first** (the card reached from the previous column's first card by its first-declared
     uncapped event — the Editor's `happyEvent`), then the rest by the **barycentre of their
     predecessors' positions in the previous columns** (classic one-pass layered ordering; ties by
     declaration order). This keeps the main row horizontal and stops row edges from crossing
     inside a column stack. Deterministic, depends on the pipeline only.
2. `layout.ts` — `columnsOf`/`layoutNodes` unchanged in shape (one column per wave, first card on
   the row line, the rest stacked below). Port the Editor's `happyEvent`, `highlightHappyPath`,
   `buildDefinitionGraph` into the Studio's file (verbatim), so the three copies converge and the
   diagram's `studio-sync` test goes green again. `blankData` gets `quiet: false`;
   `structuralEdgeClass` unchanged.
3. Runs vs. a pipeline without a run: same layout. With `state`, `decorateEdges` lights what was
   taken; without, `highlightHappyPath` lights the happy path (as the Editor does), so the
   "No state.json yet" view and the Editor look alike.

Expected result on klevrs-kp-factory: 14 wave columns + START/END; wave 8 holds
`calc-mediaplan-{ideas,mini,personal}`, `write-demo-buyer`, `write-blocks`; wave 11 holds
`build-demo-landing`, `build-landing`, `build-slides`; wave 12 the three `qa-*`; no forward edge
points left; the 13 capped routes are the only loops.

## 3. Back edges: what is drawn, and when

Even with correct waves, klevrs-kp-factory has 13 loop edges, 8 escapes and 7 routes to END
against ~25 row edges — the spaghetti is structural, so the fix is a visibility policy on top of the
existing lane routing:

**Three tiers of edges**

| tier | which | drawn as |
|---|---|---|
| row | forward edges to the next wave (and START edges) | as today |
| taken | any loop / escape / jump the run actually travelled (`taken`), or on the happy path when there is no state | as today: on its lane, dashed, lit, pills with `×n` |
| **quiet** | untaken loops, escapes and jumps (incl. `FAILED → END`) | thin, dashed, low opacity (`.edge-quiet`, ~0.18), **no pills**; arrowhead kept |

A quiet edge becomes fully visible — with pills — while either of its endpoints is focused (hover or
pin, §4). A toggle **`All routes`** in the canvas strip beside `Details` (and key `a`, same guard as
`d`) turns the quiet tier off so the whole structure can be read when wanted; it is `view` state
in `RunView` (not persisted in the URL for now — open question 4).

Lane routing stays (greedy interval lanes above/below, loops leave and enter at the bottom, escapes
and jumps at the top). With the correct waves the lanes already get much shorter: every
`REVISE → build-*` and `qa-* → approve-kp` route that is today a lane becomes a row edge. Bundling
loops that share a source and a column, and per-step END stubs instead of one END, are deliberately
left out of this change (open questions 7, 8).

## 4. Pin / dim interaction

**Pin = React Flow selection.** The selected card is already "the card the inspector shows"; the
pin simply makes the hover focus follow it.

- `focusId = hoveredId ?? pinnedId`, `pinnedId = selectedId` (the prop `GraphCanvas` already has).
  Hover wins while the pointer is on a card; leaving it falls back to the pinned card. (Alternative:
  union of both — rejected, two highlighted neighbourhoods at once is what we are trying to avoid.)
- **Connected = direct neighbours**: the card's incomers and outgoers over *all* edge kinds (row,
  loop, escape, jump, START/END). Kept edges = **only the edges incident to the focused card**
  (today an edge between two neighbours also stays — it will be dimmed, it is not "connected to the
  card"). Recommended because it is what hover does today, matches the user's words, and for a hub
  like `verify-claims` (7 neighbours, 11 incident edges) the whole-path variant would light nearly the graph.
  *Option* for later: a "path" mode (all upstream + downstream steps over the forward graph) on
  `Shift`+click — offered, not in this change.
- Quiet edges incident to the focused card are un-quieted (full opacity, pills) while focused.
- Dim level: nodes and edges outside the focus get `dimmed`; raise the effect from 0.4 to a
  token `--dim-opacity: 0.25` so pinned really reads as "everything else transparent" (open
  question 6). The pinned card keeps the existing 2 px selection ring; the pinned state needs no
  extra badge.
- **Set**: click a card (React Flow selects it → `onSelectionChange` → `onSelect`; the inspector
  opens the step pane as it does now). A log chip or a plain-view row selecting a step pins it too.
- **Clear**: (a) click the same card again — add `onNodeClick`: if `node.id === selectedId` then
  `onSelect(null)` (React Flow itself treats this click as a no-op); (b) click the empty canvas —
  React Flow already clears the selection, nothing to add; (c) `Escape` — a window `keydown`
  handler in `GraphCanvas` guarded by `isTypingTarget` (so the sidebar search and the document
  modal keep their own Escape); it calls `onSelect(null)`, and the existing `selectedId` effect
  writes `selected: false` into the nodes. Clearing the pin also closes the inspector's step pane
  (overview comes back) — same as a pane click today, so no new behaviour there.
- A run switch clears selection and hover (already).
- Implementation shape (`shared/graph/focus.ts`): keep `dimOutsideFocus` for the Editor; add
  `focusOf(nodes, edges, { hoveredId, pinnedId })` returning the focus set and a pure
  `applyFocus(nodes, edges, focus, showAllRoutes)` that overlays `dimmed` / `edge-quiet` /
  `data.dimmed` / `data.quiet` while preserving object identity of untouched items (the memo
  contract in `GraphCanvas.tsx:160-165`).

## 5. Files to change

Factory Studio (`factory-studio/`):

| file | change |
|---|---|
| `web/src/shared/graph/rank.ts` | capped routes as back edges, forward-graph DFS fallback, longest-path waves, happy-path-first + barycentre order |
| `web/src/shared/graph/layout.ts` | port `happyEvent`/`highlightHappyPath`/`buildDefinitionGraph` from the Editor; `quiet` default in `blankData`; doc comments |
| `web/src/shared/graph/graph.types.ts` | `EdgeData.quiet?: boolean`; comment: `loop` = capped route |
| `web/src/shared/graph/focus.ts` | `focusOf`, `applyFocus` (pin + hover + quiet reveal) |
| `web/src/shared/graph/FlowEdge.tsx` | no pills when `data.quiet`; `edge-label--quiet` |
| `web/src/features/runs/lib/graph.ts` | `decorateEdges`: `quiet = !taken && (loop \|\| kind === 'max' \|\| jump)`; stateless path through `highlightHappyPath` |
| `web/src/features/runs/components/GraphCanvas.tsx` | `pinnedId = selectedId`; `onNodeClick` toggle; Escape; `showAllRoutes` prop; `viewGraph = applyFocus(...)` |
| `web/src/features/runs/components/Legend.tsx`, `RunView.tsx`, `RunsScreen.tsx` | `All routes` toggle + key `a` next to `Details`/`d` |
| `web/src/shared/styles/global.css` | `.edge-quiet`, `.edge-label--quiet`, `--dim-opacity`; do **not** touch the uncommitted `.doc-prose table` block |
| `README.md` | row at `:146` and paragraph at `:249-250`: waves, quiet routes, pin/Esc, `All routes` |
| `web/package.json`, `web/vitest.config.ts`, root `package.json` | add vitest to `web`; root `test` runs both workspaces |

Factory Editor (`factory-editor/web/src/shared/graph/`): copy `rank.ts`, `layout.ts`,
`graph.types.ts`, `focus.ts`, `FlowEdge.tsx` from the Studio (they must end up identical except
`StepCard.tsx`); the Editor gets correct waves and quiet loops; its selection model is untouched.
Add `edge-quiet` CSS to its `global.css`.

factory-diagram: re-copy the four files into `src/shared/studio-graph/` (apply the header/`.js`
rewrite the sync test expects), draw quiet edges thin in `render/native/edges.ts`, regenerate
`tests/__snapshots__`. The `studio-sync` test is red today and this change is the occasion to make
it green.

## 6. Tests

New `factory-studio/web/tests/` (vitest, node environment, pure functions only — no DOM, no React):

1. `rank.test.ts`
   - a 3-step loop with one capped route: that route is the only back edge; waves 1-2-3;
   - **klevrs-kp fixture**: the 25 waves equal the table in `scout.md` (= the recorder's `order`
     in the real run); `back` is exactly the 13 capped keys;
   - shortcut `a → c` beside `a → b → c`: `c` stays at wave 3 (longest path);
   - uncapped loop: no throw, the DFS fallback flags one back edge, waves still total;
   - unreachable step: wave 1;
   - `order`: wave-sorted, happy-path card first in each wave, barycentre order deterministic.
2. `layout.test.ts` — over the fixture: every card of a wave shares one `x`; waves increase in `x`;
   for every non-loop edge `target.x > source.x`; lane `laneY` clears the extents of every column
   it spans; stacked cards do not overlap (`y + height + STACK_GAP <= next.y`).
3. `focus.test.ts` — pinned only; hover overrides pinned; only incident edges kept; quiet incident
   edge un-quieted; untouched nodes keep object identity; no focus returns the input arrays.
4. `graph.test.ts` (runs lib) — with the real-run `edges` counters: `check-facts → extract-fields`,
   `verify-claims → *` (REVISE_ALL) and `qa-slides → build-slides` are taken and not quiet; the
   other loops/escapes/`FAILED → END` are quiet; stateless: happy path lit, loops quiet.

Fixture: `web/tests/fixtures/kp-factory.pipeline.json` — the routing skeleton of
klevrs-kp-factory (`START`, per step `agent` + `transitions`; prompts, knowledge and docs stripped)
and a trimmed `kp-factory.state.json` (`status`, `edges`, `steps[*].status/order`). Open
question 9 on whether the real slugs may live in the kit's tests.

Existing: `factory-diagram` `studio-sync` back to green, its snapshots regenerated and the
`graph.test.ts` expectations reviewed; `pipeline-state` and `pipeline-validation` untouched.

## 7. Verification without screenshots

1. Per app: `npm run typecheck && npm run format:check && npm test && npm run build`
   (Studio, Editor, factory-diagram). The web tests above are the main evidence for geometry.
2. A one-off `tsx` script (like the one used in the scout) printing `wave / x / y / stackIndex` for
   every klevrs-kp-factory node and the kind/tier of every edge, run before and after; the diff is
   the review artefact.
3. Live DOM checks on `http://127.0.0.1:3110/runs/klevrs-kp-factory/<run>` through the MCP browser
   tools (`browser_evaluate` / `javascript_tool` — DOM queries, not screenshots, which hang here):
   - group `.react-flow__node` by their `transform` x → 14 distinct step columns, membership equals
     the waves table;
   - count `.react-flow__edge.edge-quiet` — expected 22 of the 28 non-row edges (the 6 taken
     ones: 5 loop edges from the 3 taken `REVISE` events and the `evaluate-against-expected → END`
     jump stay lit);
   - click `[data-id="verify-claims"]` → `.react-flow__node.dimmed` count = 27 nodes − 1 − 7
     neighbours = 19, inspector `.pane-title` reads `verify-claims`; press `Escape` → 0 dimmed, overview
     pane back; click the same card twice → same;
   - toggle `All routes` → 0 `.edge-quiet`.
4. `npm run build` in `factory-studio` and reload: the API serves the new `web/dist` without a
   restart.

## 8. Risks

- **Three copies** of the layout: the diagram has a sync test, the Editor has none — an Editor
  sync test mirroring the diagram's is cheap and recommended (open question 10).
- **Quiet tier hides information** (an untaken `REVISE` is still a possible route): mitigated by
  the hover/pin reveal and `All routes`; the plain view still lists every route.
- **Clicking a selected card now deselects** — a small behaviour change (today a no-op); it also
  closes the step pane. If unwanted, keep React Flow's no-op and rely on Escape / pane click
  (open question 2).
- **Pipelines with uncapped loops** fall back to the old DFS classification; their drawings stay as
  they are, which is acceptable because the validator already warns on them.
- **Every factory's diagram changes** (`/draw-factory` SVGs, Editor canvas) — expected; the
  snapshots document the new result.
- The barycentre ordering is new code with its own edge cases (a wave whose cards have no
  predecessors in the previous column, e.g. two START steps); covered by tests, falls back to
  declaration order.
- `happyEvent` picks the first-declared uncapped event; for a step whose first event is a human
  `STOP → END`, the "main row" could run into END early — ties should prefer an event leading to a
  step over one leading to END (one line, tested).

## 9. Open questions for the user (with the recommended answer)

1. **Wave definition** — longest path over the forward graph, capped routes are the loops, computed
   on the client for runs and definitions alike; `state.steps[*].order` not used.
   *Recommend: yes.*
2. **Pin = selection** — click pins and opens the step pane; same card again / empty canvas /
   `Escape` clear both; log chips and plain-view rows pin too. *Recommend: yes.* Alternative: a
   separate pin (double-click or a pin icon) that survives pane clicks — more state, less obvious.
3. **"Connected"** — direct neighbours over every edge kind, only the card's own edges kept.
   *Recommend: direct neighbours*; a whole-path mode later on `Shift`+click if wanted.
4. **Quiet routes by default** — untaken loops/escapes/jumps faded without pills; `All routes`
   toggle (`a`) in the canvas strip, not persisted. *Recommend: yes*; persist in the URL hash like
   `#view=detailed` only if it turns out to be used every time.
5. **Hover while pinned** — hover wins, release returns to the pin. *Recommend: yes.*
6. **Dim strength** — one `--dim-opacity: 0.25` for hover and pin (today 0.4), quiet edges 0.18.
   *Recommend: 0.25 / 0.18*; tune by eye after the first build.
7. **Loop bundling** (several loops from one source into one column sharing a lane) — *Recommend:
   not now*; re-evaluate after the waves and the quiet tier land.
8. **One END node vs. per-step END stubs** for `FAILED/STOP/REJECT → END` — *Recommend: keep the
   single END*; the quiet tier removes most of those lines from the default view.
9. **Fixture in the kit's tests** uses the real klevrs-kp-factory step slugs (routing only, no
   prompts). *Recommend: yes* — the slugs carry no business content; otherwise a renamed topology
   (`step-01…`) with the same shape.
10. **Editor and diagram updated in the same commit**, plus an Editor sync test like the
    diagram's. *Recommend: yes* — the diagram sync test is already red and the Editor copy already
    drifts.

## 10. Stage 3 — what was built, and where it differs from the plan

Built as planned unless listed here.

- **Counts corrected**: the fixture has 29 off-row edges (13 loops, 8 escapes, 8 jumps to END —
  `approve-kp REJECT → END` is a route beside its `:max` escape), 6 taken, 23 quiet; the real
  run on screen shows 22 quiet (it took one loop more). Tests use these numbers.
- **`happyEvent` lives in `rank.ts`** (not `layout.ts`) because the main-row ordering needs it
  before the ranks exist; it prefers an event that leads to a step over one that ends the run
  (tested). `highlightHappyPath` and `buildDefinitionGraph` were ported into `layout.ts` as planned.
- **Focus API**: one `applyFocus(nodes, edges, { hoveredId, pinnedId }, showAllRoutes)` plus
  `focusIdOf`, instead of a `focusOf`/`applyFocus` pair. `EdgeData` carries the structural `quiet`
  and the overlay's `hushed` (label hidden now); the class `edge-quiet` is added by the overlay,
  never by `decorateEdges`. `dimOutsideFocus`/`dimExcept` stay for the Editor's happy-path switch.
- **Ties inside a wave** break by the step's declaration order in `steps` (START order was
  considered and dropped: one rule is enough and the main row already comes first).
- **`All routes`** is React state in `RunView` (survives a run switch, not persisted); its key `a`
  is handled there, next to the Studio's `d`. The `Escape` listener in `GraphCanvas` is attached
  only while a card is selected.
- **Stateless run** lights the happy path in the taken (completed) tone, as the Editor does — a
  visual to review; if the green reads as "completed" on a run that never ran, a `--st-none`
  tone for the lit happy path is a one-line CSS change (`.edge-taken` under `.graph-wrap.is-stateless`).
- **Factory Editor**: View mode now hushes the loops, escapes and jumps off the happy path until a
  card is hovered; Edit mode draws every route in full (`applyFocus(…, editing)`). Not in the
  plan, but the cheapest way to make the copied files earn their place. A sync test
  `factory-editor/api/tests/studio-graph-sync.test.ts` guards eight copied files
  (`StepCard.tsx` differs on purpose).
- **factory-diagram**: the graph model (and `--format json`) gained `quiet` on every edge; the SVG
  draws a quiet edge at 0.45 opacity with a 1 px line and keeps its pills (a picture has no
  hover). Snapshots regenerated; the only non-`quiet` differences are the intended ones — node
  order by wave, and the edge kinds of the factories whose capped retry used to be drawn forward
  (`aws-architecture-factory`: `validation-gate —REVISE→ revise-architecture` is now the loop;
  `mckinsey-`/`strategy-research-factory`: `partner-review —RESEARCH_MORE→ research-players`).
  Two diagram tests fail in this project before and after the change (`feature-factory builds
  without warnings`, `--all … --strict`): the validator's `knowledge-exists` warning, because
  `factories-data/feature-factory/` is not created here. Not touched.
- **Test runner**: vitest 3.2.7 in `web` (hoisted, same major as `api`), `web/vitest.config.ts`,
  `web/tsconfig.test.json` (typecheck covers the tests), prettier globs include `tests/`; the root
  `npm test` now runs both workspaces. Fixtures: `web/tests/fixtures/kp-factory.{pipeline,state}.json`.

### Verified

- Studio: `typecheck`, `format:check`, `test` (api 141 + web 24), `build` — green.
- Editor: `typecheck`, `format:check`, `test` (102, sync test included), `build` — green.
- Diagram: `typecheck`, `format:check`; tests green except the two pre-existing environment
  failures above.
- Live DOM on `http://127.0.0.1:3110/runs/klevrs-kp-factory/<lead>-2026-10-19` (the
  already-running Studio serving the rebuilt `web/dist`): 25 step nodes in 14 columns, every
  step's column index equals the recorder's `order` in that run's `state.json` (no mismatches);
  62 edges, 22 `edge-quiet` at computed opacity 0.18, 39 labels; click `verify-claims` → 1
  selected, 19 dimmed nodes (27 − 1 − 7 neighbours) at opacity 0.25, 51 dimmed edges, its 4
  quiet edges revealed (labels 39 → 43), inspector pane title `verify-claims`; second click,
  `Escape` and a pane click each return to 0 selected / 0 dimmed; `a` → 0 quiet, 61 labels,
  `All routes` pressed; `a` again → 22 quiet.

### Not verified

- Nothing by eye: no screenshots work on this machine. Lane geometry, pill placement and the
  dim/quiet levels are checked by numbers only; the levels (0.25 / 0.18) may want tuning.
- The Editor in a browser (build and tests only) and the regenerated SVGs as pictures.
- Hover (`mouseenter` on a React Flow node) was not driven from the DOM; the overlay it shares
  with the pin is unit-tested.
