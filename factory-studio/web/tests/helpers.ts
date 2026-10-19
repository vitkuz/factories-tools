import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipelineSchema, runStateSchema } from '../src/features/runs/lib/dashboard.schema';
import type { Pipeline, RunState } from '../src/features/runs/lib/types';
import type { GraphPipeline, GraphRoute } from '../src/shared/graph';

const FIXTURES: string = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

const readJson = (name: string): unknown =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));

/**
 * The routing skeleton of the project's `klevrs-kp-factory` (25 steps, 51 routes, 13 capped
 * loops): START, and per step its agent and transitions. Prompts and documents are stripped.
 */
export const kpPipeline = (): Pipeline =>
  pipelineSchema.parse(readJson('kp-factory.pipeline.json'));

/**
 * The trimmed `state.json` of a completed run of it: the recorder's `order` per step (its
 * wave), statuses, and the `edges` counters (three retry loops were taken).
 */
export const kpState = (): RunState => runStateSchema.parse(readJson('kp-factory.state.json'));

/** A route literal: `r(['b'])`, `r(['a'], { max: 2, onMax: ['c'] })`. */
export const r = (target: string[], extra: Partial<GraphRoute> = {}): GraphRoute => ({
  target,
  ...extra,
});

/** A small pipeline from `{ slug: { EVENT: route } }` for the shape under test. */
export const tiny = (
  START: string[],
  steps: Record<string, Record<string, GraphRoute>>,
): GraphPipeline => ({
  START,
  steps: Object.fromEntries(
    Object.entries(steps).map(([slug, transitions]): [string, GraphPipeline['steps'][string]] => [
      slug,
      { agent: 'general-purpose', transitions },
    ]),
  ),
});
