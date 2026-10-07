import { describe, expect, it } from 'vitest';
import { normalizeState, serializeState } from '../../src/features/state/state.utils.js';
import type { State } from '../../src/features/state/state.types.js';

const state: State = {
  vars: { b: 1, a: 2 },
  edges: {},
  frontier: [],
  steps: {
    zed: { status: 'PENDING', order: 1, agent: 'x', kind: 'agent' },
    alpha: { order: 1, status: 'PENDING' },
  },
  context: { constants: {}, params: {}, captured: {} },
  currentWave: 1,
  updatedAt: '2026-10-07T12:00:00Z',
  createdAt: '2026-10-07T12:00:00Z',
  status: 'IDLE',
  pipelineName: 'demo',
  runId: 'run-1',
  history: [
    {
      timestamp: '2026-10-07T12:00:00Z',
      type: 'PIPELINE_INIT',
      message: 'm',
      details: { z: 1, a: 2 },
    },
  ],
};

describe('the written form of state.json', () => {
  it('fixes the key order, sorts every map, drops an empty frontier', () => {
    const written = normalizeState(state);
    expect(Object.keys(written)).toEqual([
      'runId',
      'pipelineName',
      'status',
      'createdAt',
      'updatedAt',
      'currentWave',
      'context',
      'steps',
      'history',
      'edges',
      'vars',
    ]);
    expect(Object.keys(written.steps)).toEqual(['alpha', 'zed']);
    expect(Object.keys(written.steps['zed'] ?? {})).toEqual(['order', 'kind', 'agent', 'status']);
    expect(Object.keys(written.vars ?? {})).toEqual(['a', 'b']);
    expect(Object.keys(written.history?.[0]?.details ?? {})).toEqual(['a', 'z']);
    expect(written.frontier).toBeUndefined();
  });

  it('serializes as two-space JSON with one trailing newline, the same every time', () => {
    const text = serializeState(state);
    expect(text.endsWith('}\n')).toBe(true);
    expect(serializeState({ ...state })).toBe(text);
  });
});
