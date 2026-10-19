# Graph readability — scout

Stage 1 of the "make complex factory graphs readable" task. Facts only; the plan is in
`plan.md` beside this file. Paths are relative to `factories-tools/` unless absolute.

Docs convention: the repo has no `docs/` per app — each app documents itself in its `README.md`
(`factory-studio/README.md`, `factory-editor/README.md`); the only `docs/` folder is
`ai-usage/docs/factory-guide.md`, and `factory-studio/reference/runs-sidebar.html` is a design
reference. This folder (`factory-studio/docs/graph-readability/`) follows the `ai-usage/docs`
precedent. The README's run-screen row (`factory-studio/README.md:146`) and the layout paragraph
(`:249-250`) are where the user-facing behaviour is described and will need updating.

## 1. Where the graph comes from

**API side — no graph logic.** `GET /api/v1/runs` (`factory-studio/api/src/features/runs/`) returns
`DashboardData`: `pipelines` (every `pipeline.json` found, keyed by id, `runs.utils.ts:43-60`) and
`runs[]` (`runId`, `pipelineId`, `state` = `state.json` as written, `cost`, the run's own
`pipeline.json` snapshot). The API never lays anything out.

**Client side — everything.** `web/src/features/runs/RunsScreen.tsx:84-92` builds the graph once
per (pipeline object, run object, card mode):

```
buildGraph(pipeline, { detailed, cost })(run.state ?? null)      // lib/graph.ts:302-317
  rankPipeline(pipeline)                                          // shared/graph/rank.ts:48-93
  layoutNodes(pipeline, ranks, stepNodeData(...), stepNodeHeight) // shared/graph/layout.ts:174-219
  buildEdges(pipeline, ranks, stackedIds(nodes))                  // shared/graph/layout.ts:314-378
  assignLanes(nodes, ranks)(edges)                                // shared/graph/layout.ts:416-464
  decorateEdges(deriveTraversals(pipeline)(state), state)(edges)  // lib/graph.ts:264-299
```

The pure, run-agnostic part lives in `web/src/shared/graph/` (`rank.ts`, `layout.ts`, `text.ts`,
`graph.types.ts`, `focus.ts`, `fit.ts`, `FlowEdge.tsx`, `StepCard.tsx`, `TerminalNode.tsx`,
`AutoMiniMap.tsx`). The run-aware decoration is in `web/src/features/runs/lib/` (`graph.ts`,
`history.ts`, `attempts.ts`, `cost.ts`). Rendering is React Flow (`@xyflow/react` 12.11) in
`web/src/features/runs/components/GraphCanvas.tsx` with node types `step` (`nodes/StepNode.tsx`),
`start`/`end` (`shared/graph/TerminalNode.tsx`) and the one edge type `flow` (`shared/graph/FlowEdge.tsx`).

Positions are never stored: "The graph keeps no node positions: it is laid out from the pipeline
alone" (`README.md:249-250`). Layout depends on `pipeline.json` only; run state only decorates.

## 2. The current layout algorithm (custom, no dagre/elk)

### 2.1 Ranks — `shared/graph/rank.ts`

- `targetsOf` (`rank.ts:32-46`): every routing target of a step in declaration order — each
  event's `target[]`, then its `onMax[]`.
- `rankPipeline` (`rank.ts:48-93`): **a depth-first walk from START** (`:55-67`). An edge whose
  target is still on the DFS stack is a *back edge* (`:62`, kept in `ranks.back` as
  `"source->target"` keys). Steps unreachable from START are walked afterwards (`:70`). Over the
  non-back edges the **rank is the longest path from START** (`:72-89`); START = 0, END =
  max + 1 (`:90`). `ranks.order` = DFS discovery order (`:58`) — the primary route first, which is
  what becomes the "main row".
- The comment at `rank.ts:9-18` explains the longest-path choice: a shortcut (`SKIP`) must not pull
  its target left.

**The defect.** Back-edge classification is *DFS-order dependent*. For
`factories.local/klevrs-kp-factory/pipeline.json` the walk goes `review-inputs → route-mediaplan →
… → verify-claims → PASS → build-demo-landing → qa-demo-landing → approve-kp` before it ever
returns to `review-inputs`' second target `research-buyer`. From `approve-kp`, the retry route
`REVISE_TEXT → write-blocks` finds `write-blocks` unvisited, so that capped retry is treated as a
*forward* edge, and `write-blocks → build-claims` (the real forward edge) is flagged as the loop.
Same for `write-demo-buyer`, `build-landing`, `build-slides` (via `REVISE_PAGES`) and
`qa-landing → approve-kp`, `qa-slides → approve-kp`. Measured with the real file (script run with
`tsx` against `rank.ts`):

| step | `rank.ts` today | longest path with capped routes as loops | `state.steps[*].order` (recorder) |
|---|---|---|---|
| write-demo-buyer, write-blocks | 14 | 8 | 8 |
| build-landing, build-slides | 14 | 11 | 11 |
| qa-landing, qa-slides | 15 | 12 | 12 |
| every other step (19) | same | same | same |

`ranks.back` today holds 11 edges, among them the forward edges `write-blocks->build-claims`,
`write-demo-buyer->build-claims`, `qa-landing->approve-kp`, `qa-slides->approve-kp`,
`qa-landing->build-landing`, `qa-slides->build-slides` — while `approve-kp->write-blocks`,
`approve-kp->build-landing` etc. (the capped retries) are drawn as forward row/jump edges. This is
the "steps of the same stage scattered vertically" and most of the lane spaghetti in the screenshot:
the right-hand column mixes `prepare-crm-update` (wave 14) with `write-blocks` (wave 8) and
`build-landing` (wave 11), and their real forward edges are drawn as loops on lanes.

### 2.2 Columns and stacking — `shared/graph/layout.ts`

- Fixed card sizes (`layout.ts:28-42`): `NODE_W 156`, `NODE_H 104` (compact), `STEP_GAP 72`,
  `STACK_GAP 56`, lanes `LANE_ABOVE 64`, `LANE_BELOW 40`, `LANE_PITCH 32`. Detailed card height is
  computed, not measured (`stepNodeHeight`, `:97-111`, must match the CSS).
- `columnsOf` (`:121-130`): one column per rank, cards in `ranks.order` (DFS) order.
- `layoutNodes` (`:174-219`): START at x 0, columns left to right; **the first card of a column is
  centred on y = 0 (the row line), the rest stack below it** (`:195-201`); column gap grows to fit
  the widest pill row between two columns (`labelWidthBetween`, `:133-161`); END after the last
  column. So the layout is already left-to-right with one column per rank — the user's request is
  really "make the columns *be* the waves".
- `stackedIds` (`:222-227`): cards with `stackIndex > 0` (lane edges into them use the left handle).

### 2.3 Edges — `layout.ts:229-378`, `FlowEdge.tsx`, `StepCard.tsx`

- `groupRoutes` (`:243-269`): one edge per (source, target) carrying every event that routes
  there (`results[]`, `routes[]`); ids `e:src->tgt` and `e:src->tgt:max` (`:69-70`). A dangling
  target draws nothing (`:238-241`).
- Three kinds (`graph.types.ts:56`): `start` (START → entry steps), `route`, `max` (an `onMax`
  escape, one per `onMax` target of the *first* capped event of a step, `:355-376`; `stepMax`
  `:76-77` and `cappedRoute` `:80-83` take the first capped route only — a known limit also noted
  in `factory-diagram/README.md`).
- Flags (`graph.types.ts:74-80`): `loop` = `ranks.back` has the key (`:341`); `jump` = forward edge
  spanning > 1 column (`:342`); `lane` = `'above'` for `max`/jump, `'below'` for loops, `'row'`
  otherwise (`:283`).
- Handles (`StepCard.tsx:12-47`): eight invisible handles — row edges right→left (`out`/`in`),
  loops leave bottom-left and enter bottom-right (`loop-out`/`loop-in`), escapes top-right→top-left
  (`max-out`/`max-in`), jumps top centre (`jump-out`/`jump-in`); into a stacked card or a terminal
  the lane edge uses the left `in` handle (`handlesFor`, `layout.ts:292-311`).
- Lanes (`assignLanes`, `:416-464`): per-rank vertical bounds of all cards; an above/below edge
  gets a lane y that clears every column it spans; parallel lanes are allocated by greedy interval
  colouring, shortest span nearest the row (`allocateLanes`, `:394-410`). The result goes to
  `data.laneY`; `FlowEdge.tsx:79-87` turns it into the `offset` of React Flow's
  `getSmoothStepPath` (`:89-98`), so a lane edge is: vertical out of the handle, horizontal along
  the lane, vertical into the target.
- Labels (`FlowEdge.tsx:45-61, 100-145`): one pill per result, placed at the lane's horizontal
  midpoint (lanes) or the path midpoint (row); loops show `↺`; a traversal count `×n` is shown from
  1 for loops/escapes and from 2 for forward routes. Pill backgrounds are the canvas colour, which
  visually "cuts" the line. Label dimming via `data.dimmed` → `edge-label--dimmed` (`:114`).
- Structural class (`structuralEdgeClass`, `layout.ts:469-476`): `edge-max` / `edge-loop` /
  `edge-jump` / `edge-forward`; CSS dashes loop/max/jump/skip (`global.css:1225-1230`), taken edges
  are green 3 px (`:1232-1235`, lanes 2 px `:1237-1243`), `edge-bypassed` opacity .4 (`:1249-1251`).

### 2.4 Run decoration — `features/runs/lib/graph.ts`, `history.ts`

- `deriveTraversals` (`history.ts:90-110`): reads `state.edges` (`"<step>:<EVENT>": n`,
  `dashboard.schema.ts:170`); a capped route spends `max` traversals on its target and the overflow
  on its `onMax` edges (`hopsFor`, `:60-82`). Nothing is reconstructed from history text.
- `decorateEdges` (`graph.ts:264-299`): `traversals`, `taken`, `takenResults`, `tone`
  (`skipped` when only `SKIP` was travelled), `bypassed` (untaken and touching a SKIPPED step),
  `live` (the comet into the current step, `liveEdgeId` `:243-259`), and the class list.
- `stepNodeData` (`graph.ts:195-233`): status (`waiting` when the run is paused on the step),
  attempts/passes, result event, docs, duration, cost, `current`.

Run state available on the client (`dashboard.schema.ts`): `status`, `mode` (`'graph'`),
`currentWave` (`:159-161`), `activeSteps`, `frontier` (`:164`), `steps[slug]` with `order`
(`:106-107`), `status`, `passes`, `event`, `history[]` of passes, `skipReason`; the run
`history[]` of entries (`:139-144`); `edges` counters (`:170`); `pause`.

## 3. What "wave" means in this codebase

- **Recorder** (`pipeline-state`): on `open`, every step gets `order = layersOf(pipeline)[name]`
  (`src/features/commands/open.command.ts:16-31`). `layersOf` (`src/features/pipeline/graph.utils.ts:51-72`)
  is a **breadth-first depth from START** over *all* neighbours (targets and `onMax`), first
  discovery wins (so it is a shortest-path layer, not longest-path). `currentWave` is bumped to
  `max(currentWave, step.order)` when a step starts (`start-step.command.ts:50`). `WAVE_START` is
  recorded once, at start (`start.command.ts:14-15`); the real run's history has exactly one
  `WAVE_START` and 71 entries total — waves are not logged per step.
- **Forward graph, as the kit defines it**: `forwardNeighbours` (`graph.utils.ts:19-27`): "Every
  loop closes through an edge with `max`, so dropping those leaves a graph without cycles; onMax
  targets are exits, so they stay." The validator enforces the premise as a warning:
  `loops-capped` — "every loop passes an edge with `max`"
  (`pipeline-validation/src/features/rules/pipeline/loops-capped.rule.ts`, README line 46).
- **The schemas disagree with the data**: `factories/state.schema.json:169` and
  `dashboard.schema.ts:106` say "a graph step leaves `order` at 0", but the current recorder writes
  the BFS layer for graph runs (the real run has orders 1–14 for all 25 steps; `frontier` is
  `null`, `currentWave` 14, `activeSteps` `[]`).
- **Studio** does not use `order` or `currentWave` anywhere (`grep` of `web/src`): the only consumer
  of a rank is `rankPipeline` (`PlainView.tsx:300` orders the plain list by `ranks.order` too).
- For klevrs-kp-factory, *BFS layer == longest path with capped routes removed* for all 25 steps
  (table above). They differ in general only on a shortcut edge, where longest-path is the one that
  never draws a forward edge pointing left.

## 4. Hover highlighting, click, selection, inspector

- **Hover** (`GraphCanvas.tsx:88, 160-175`): `onNodeMouseEnter` sets `hoveredId`; leave clears it
  after 140 ms. `dimOutsideFocus(nodes, edges, hoveredId)` (`shared/graph/focus.ts:17-36`) keeps the
  hovered node and its **direct neighbours** — `getIncomers` + `getOutgoers` over *all* edges (row,
  loop, max, jump; START/END included) — and keeps an edge only when **both ends are in that set**
  (so an edge between two neighbours stays lit too). Everything else gets class `dimmed` (nodes and
  edges) plus `data.dimmed` on edges for the label (`dimExcept`, `:39-57`). CSS: `.react-flow__node.dimmed,
  .react-flow__edge.dimmed { opacity: 0.4 }` (`global.css:1211-1214`), 120 ms opacity transition
  (`:1318-1323`). It is an overlay: untouched node objects keep identity so memoised `StepNode`s
  skip re-rendering (`GraphCanvas.tsx:160-165`).
- **Click / selection**: there is no `onNodeClick`/`onPaneClick`; React Flow's own selection does
  the work (`elementsSelectable` default true, `selectNodesOnDrag={false}`, nodes not draggable,
  `GraphCanvas.tsx:189-193`). `onSelectionChange` (`:151-158`) reports the first selected node id to
  `onSelect` → `RunView.tsx:53` `selectedId` state. Clicking the empty pane makes React Flow clear
  the selection → `onSelect(null)`. Clicking an already selected card is a no-op for React Flow.
  Selection coming from *outside* the canvas (a log chip `LogList.tsx:39`, the plain view
  `PlainView.tsx:356,375-376`) is written into the nodes by the effect at `GraphCanvas.tsx:138-149`
  (`reported` ref tells the two sources apart). A run switch clears selection and hover
  (`RunView.tsx:64-71`, `GraphCanvas.tsx:106-110`).
- **Selected look**: a 2 px `--ink` ring (`global.css:1198-1204`); the minimap colours by status.
- **Inspector** (`components/Inspector.tsx:404-411` props, `:439-444`): with `selectedId` it shows
  the step pane (`:607-609`: title, agent/model, status badge, attempts, result, docs, prompt, cost);
  without it, the run overview with the cost breakdown (`:583`). So **selection = "what the
  inspector shows"**; a pin that follows selection does not break it, a pin that *replaces*
  selection semantics would.
- **Keyboard**: `d` toggles compact/detailed (`RunsScreen.tsx:63-70`, guarded by `isTypingTarget`,
  `shared/lib/keys.ts`). There is no `Escape` handling on the runs screen (only the document modal
  `DocModal.tsx:272,337` and the sidebar search `RunSidebar.tsx:167`). React Flow's `deleteKeyCode`
  is disabled (`GraphCanvas.tsx:193`).
- **Fit** (`shared/graph/fit.ts`): fit on run/mode switch, never on a live refresh; a fit below zoom
  0.5 falls back to a readable zoom with Start at the left (`:26-64`); minimap only when the graph
  is larger than the view (`AutoMiniMap.tsx:20-34`).

## 5. The Factory Editor and factory-diagram share this code — by copy

- `factory-editor/web/src/shared/graph/` is a **copy**, not an import. `diff` today: `rank.ts`,
  `text.ts`, `focus.ts`, `FlowEdge.tsx`, `fit.ts`, `index.ts` identical; `layout.ts` differs — the
  Editor's has `happyEvent`, `highlightHappyPath` and `buildDefinitionGraph`
  (`factory-editor/.../layout.ts:477-531`) that the Studio's lacks (plus comment wording);
  `graph.types.ts` and `StepCard.tsx` differ in comments and the Studio-only `status` prop.
- The Editor uses the same hover dim (`EditorScreen.tsx:167, 214-224`) plus a **"Happy path"**
  toggle (`Toolbar.tsx:147-151`, `lib/graph.utils.ts:98-108` `dimOffHappyPath`) and its own
  `onNodeClick`/`onPaneClick` selection model (`EditorScreen.tsx:815-830`).
- `factory-diagram/src/shared/studio-graph/` (`rank.ts`, `layout.ts`, `text.ts`, `graph.types.ts`)
  is documented as "a verbatim copy of factory-studio/web/src/shared/graph/" and guarded by
  `tests/studio-sync.test.ts`. **That test fails today** (2 of 4 files: `layout.ts`,
  `graph.types.ts`) — the copy was taken from the Editor's version (it imports
  `buildDefinitionGraph`, `render/native/layout.service.ts:4`). Verified with
  `npx vitest run tests/studio-sync.test.ts` in `factory-diagram/`. Any change to the Studio's
  `rank.ts`/`layout.ts` has to be copied to both apps and the diagram's snapshots
  (`tests/__snapshots__`) regenerated.

## 6. Tests that cover it

- `factory-studio/web` has **no test runner** (`package.json`: no vitest; root `npm test` runs
  `-w api` only). The API suite (`api/tests/*.test.ts`, vitest, HTTP against temp work dirs) does
  not touch layout.
- `factory-editor/web` likewise has no tests.
- `factory-diagram/tests/{graph,svg,draw,load}.test.ts` exercise the ported layout indirectly
  (SVG snapshots, graph model JSON) and `studio-sync.test.ts` guards the copy.
- `pipeline-state/tests/commands.test.ts:101-117, 180` pins the recorder's `order` values for its
  fixtures; `pipeline-validation/tests/rules.test.ts` covers `loops-capped`.

## 7. Working state and environment

- Submodule `factories-tools` is at `c7c005e` (full-height sidebar / one top bar); uncommitted:
  only the unrelated `.doc-prose table` edits in both apps' `global.css` (leave alone).
- Studio for this project: API `127.0.0.1:3110`, Vite dev `5179` (`factory-studio/api/.env`,
  `WORK_DIR=/home/kuzmenka/smekalka-test-pipline`). A rebuilt `web/dist` is served without an API
  restart (`README.md`).
- Real data for the task: `factories.local/klevrs-kp-factory/pipeline.json` (25 steps, 51 routes;
  13 capped loop edges after grouping, 8 escapes, 8 routes to END) and
  `run/klevrs-kp-factory/d-serikbayev-east-kazakhstan-technical-university-2026-10-18/state.json`
  (COMPLETED, graph mode, 26 edge counters, loops taken: `check-facts:REVISE`,
  `verify-claims:REVISE_ALL`, `qa-slides:REVISE`).
