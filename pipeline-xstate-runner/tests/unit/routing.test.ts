// Learned from factories-tools/pipeline-state/tests/routing.test.ts
import { describe, expect, it } from 'vitest';
import type { Pipeline } from '../../src/features/pipeline/pipeline.types.js';
import { layersOf } from '../../src/features/pipeline/pipeline.utils.js';
import {
  lookupIn,
  readinessOf,
  resolveEdge,
  slugOf,
  strandedSteps,
} from '../../src/features/routing/index.js';
import type { ConditionScopes } from '../../src/features/routing/index.js';
import type { State } from '../../src/features/state/state.types.js';

const scopes = (vars: Record<string, unknown> = {}): ConditionScopes => ({
  vars,
  params: { topic: 'cats', level: 2 },
  constants: { tone: 'plain' },
  builtIns: { id: 'demo', date: '2026-10-07', slug: 'my-topic' },
});

const agent = (
  transitions: Pipeline['steps'][string]['transitions'],
): Pipeline['steps'][string] => ({
  agent: 'general-purpose',
  prompt: ['go'],
  transitions,
});

/** draft → review (APPROVE if score >= 8 → END, REVISE → draft max 1 onMax polish, STUCK → draft max 1) */
const reviewPipeline = (): Pipeline => ({
  id: 'demo',
  constants: { rootPath: 'cwd', skillPath: '.', homePath: '~' },
  outputDir: 'run',
  START: ['draft'],
  steps: {
    draft: agent({ DONE: { target: ['review'] } }),
    review: agent({
      APPROVE: { target: ['END'], condition: 'score >= 8' },
      REVISE: { target: ['draft'], max: 1, onMax: ['polish'] },
      STUCK: { target: ['draft'], max: 1 },
    }),
    polish: agent({ DONE: { target: ['END'], condition: 'level > 5' } }),
  },
});

/** split → left + right → join (fan-in) → END. */
const fanPipeline = (): Pipeline => ({
  id: 'fan',
  constants: { rootPath: 'cwd', skillPath: '.', homePath: '~' },
  outputDir: 'run',
  START: ['split'],
  steps: {
    split: agent({ BOTH: { target: ['left', 'right'] }, LEFT: { target: ['left'] } }),
    left: agent({ DONE: { target: ['join'] } }),
    right: agent({ DONE: { target: ['join'] } }),
    join: agent({ DONE: { target: ['END'] } }),
  },
});

const stateOf = (pipeline: Pipeline, fields: Partial<State>): State => ({
  runId: 'run-x',
  pipelineName: pipeline.id,
  status: 'RUNNING',
  createdAt: '2026-10-07T12:00:00Z',
  updatedAt: '2026-10-07T12:00:00Z',
  currentWave: 1,
  activeSteps: [],
  context: { constants: {}, params: {}, captured: {} },
  steps: Object.fromEntries(
    Object.keys(pipeline.steps).map((name) => [name, { order: 1, status: 'PENDING' as const }]),
  ),
  ...fields,
});

describe('resolveEdge', () => {
  const route = (vars: Record<string, unknown>, counts: Record<string, number> = {}) =>
    resolveEdge(reviewPipeline())(lookupIn(scopes(vars)), counts);

  it('takes the edge when its condition holds', () => {
    expect(route({ score: 9 })('review', 'APPROVE')).toEqual({
      ok: true,
      value: { key: 'review:APPROVE', taken: 'APPROVE', targets: ['END'], capped: false },
    });
  });

  it('falls back to the first unconditional edge when the condition is false', () => {
    expect(route({ score: 3 })('review', 'APPROVE')).toEqual({
      ok: true,
      value: { key: 'review:REVISE', taken: 'REVISE', targets: ['draft'], capped: false },
    });
  });

  it('takes onMax once the max is spent', () => {
    expect(route({}, { 'review:REVISE': 1 })('review', 'REVISE')).toEqual({
      ok: true,
      value: { key: 'review:REVISE', taken: 'REVISE', targets: ['polish'], capped: true, max: 1 },
    });
  });

  it('names each way it can fail', () => {
    expect(route({})('review', 'NOPE')).toMatchObject({ ok: false, reason: 'unknown-event' });
    expect(route({})('review', 'APPROVE')).toMatchObject({ ok: false, reason: 'bad-condition' });
    expect(route({})('polish', 'DONE')).toMatchObject({ ok: false, reason: 'no-fallback' });
    expect(route({}, { 'review:STUCK': 1 })('review', 'STUCK')).toMatchObject({
      ok: false,
      reason: 'cap-spent',
      error: 'edge review:STUCK was taken 1 time(s), its max, and has no onMax: the run stops here',
    });
  });
});

describe('readinessOf', () => {
  const fan: Pipeline = fanPipeline();

  it('a routed step nothing live can reach is ready', () => {
    expect(readinessOf(fan)(stateOf(fan, { frontier: ['left', 'right'] }))).toEqual({
      ready: ['left', 'right'],
      running: [],
      waiting: {},
    });
  });

  it('a fan-in waits for every live branch that can still reach it', () => {
    expect(readinessOf(fan)(stateOf(fan, { activeSteps: ['right'], frontier: ['join'] }))).toEqual({
      ready: [],
      running: ['right'],
      waiting: { join: ['right'] },
    });
  });

  it('a retry loop (an edge with max) does not make a step wait', () => {
    const demo: Pipeline = reviewPipeline();
    expect(
      readinessOf(demo)(stateOf(demo, { activeSteps: ['review'], frontier: ['draft'] })).ready,
    ).toEqual(['draft']);
  });
});

describe('strandedSteps and layersOf', () => {
  it('finds never-started steps nothing live can reach', () => {
    const fan: Pipeline = fanPipeline();
    const state: State = stateOf(fan, { frontier: ['left'] });
    state.steps['split'] = { order: 1, status: 'COMPLETED', passes: 1 };
    expect(strandedSteps(fan)(state)).toEqual(['right']);
  });

  it('numbers steps breadth first from START', () => {
    const demo: Pipeline = reviewPipeline();
    expect(layersOf(demo, demo.START)).toEqual({ draft: 1, review: 2, polish: 3 });
  });

  it('slug drops the date suffix of the run folder', () => {
    expect(slugOf('/r/my-topic-2026-10-07')).toBe('my-topic');
  });
});
