import { z } from 'zod';

/**
 * The graph model — the contract between loading and every renderer, and what `--format json`
 * prints. Semantics only: no colours, no pixels. Positions belong to a renderer.
 */

export const nodeKindSchema = z.enum(['start', 'step', 'human', 'end']);
export const edgeKindSchema = z.enum(['forward', 'loop', 'max', 'jump']);
export const edgeLaneSchema = z.enum(['row', 'above', 'below']);

export const graphNodeSchema = z.strictObject({
  /** The step slug, or `START` / `END`. */
  id: z.string().min(1),
  kind: nodeKindSchema,
  /** `null` on a terminal; the agent type on a step; `human` on a gate. */
  agent: z.string().nullable(),
  /** The model alias as written; `null` when the step names none or waits for a person. */
  model: z.string().nullable(),
  /** Longest-path column from START (0); END is `maxRank + 1`. */
  rank: z.number().int().min(0),
  /** 0 for the main-row card of a column, 1+ for cards stacked under it. */
  stackIndex: z.number().int().min(0),
  /** The retry cap this step carries, when one of its events loops back with `max`. */
  max: z.number().int().min(1).nullable(),
  inputs: z.array(z.string()),
  outputs: z.array(z.string()),
  /** Knowledge paths as people read them: relative to the factory / skill / root folder. */
  knowledge: z.array(z.string()),
  /** First line of the prompt with every known variable filled; `null` on a terminal. */
  prompt: z.string().nullable(),
  /** The validator found no path from START to this step: drawn with a warning badge. */
  unreachable: z.boolean(),
});

export const graphEdgeSchema = z.strictObject({
  /** `e:<source>-><target>`, with `:max` on an escape — never collides with a route. */
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  kind: edgeKindSchema,
  /** The events that route along this edge; `[]` from START, `['max']` on an escape. */
  results: z.array(z.string()),
  /** The cap on `event`, when one of this edge's events carries `max` (on an escape: the cap it springs from). */
  max: z.number().int().min(1).nullable(),
  /** The capped event among `results`; on an escape, the event whose spent cap it follows. */
  event: z.string().nullable(),
  lane: edgeLaneSchema,
  /** On the happy path: START edges and each step's first forward-going event. */
  happy: z.boolean(),
});

export const graphModelSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().nullable(),
  description: z.string().nullable(),
  author: z.string().nullable(),
  /** The pipeline.json the model was built from, relative to the repository root (`factories/<id>/pipeline.json`). */
  file: z.string().min(1),
  stepCount: z.number().int().min(0),
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  /** Rank per node id, START and END included. */
  ranks: z.record(z.string(), z.number().int().min(0)),
  /** `{{name}}` → text, as the runner would resolve them before a run (date and params left as written). */
  variables: z.record(z.string(), z.string()),
  outputDir: z.string(),
  warnings: z.array(z.string()),
});
