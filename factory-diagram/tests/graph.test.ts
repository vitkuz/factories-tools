import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  graphModelSchema,
  toGraphPipeline,
  type GraphEdge,
  type GraphModel,
} from '../src/features/graph/index.js';
import { rankPipeline } from '../src/shared/studio-graph/index.js';
import { ROOT, fixtureFile, modelOf, portable } from './helpers.js';

const FIXTURES: readonly string[] = [
  'linear',
  'fan-out-fan-in',
  'review-loop',
  'shortcut-jump',
  'human-gate',
  'legacy-prompts',
  'dangling-unreachable',
];

const factoryIds = (): string[] =>
  fs
    .readdirSync(path.join(ROOT, 'factories'), { withFileTypes: true })
    .filter((entry: fs.Dirent): boolean => entry.isDirectory())
    .map((entry: fs.Dirent): string => entry.name)
    .filter((id: string): boolean =>
      fs.existsSync(path.join(ROOT, 'factories', id, 'pipeline.json')),
    )
    .sort();

const edge = (model: GraphModel, id: string): GraphEdge => {
  const found: GraphEdge | undefined = model.edges.find((e: GraphEdge): boolean => e.id === id);
  if (!found) throw new Error(`no edge ${id} in ${model.edges.map((e) => e.id).join(', ')}`);
  return found;
};

describe('the graph model of each fixture', () => {
  it.each(FIXTURES)('%s matches its snapshot and the model schema', (name: string) => {
    const model: GraphModel = portable(modelOf(fixtureFile(name)));
    expect(graphModelSchema.parse(model)).toEqual(model);
    expect(model).toMatchSnapshot();
  });

  it('2: fans out from START and stacks the siblings under the main row', () => {
    const model: GraphModel = modelOf(fixtureFile('fan-out-fan-in'));
    expect(model.edges.filter((e: GraphEdge): boolean => e.source === 'START')).toHaveLength(2);
    expect(model.nodes.find((n) => n.id === 'scout-front')?.stackIndex).toBe(1);
    expect(model.nodes.find((n) => n.id === 'test-b')?.stackIndex).toBe(1);
    expect(model.edges.filter((e: GraphEdge): boolean => e.target === 'report')).toHaveLength(2);
  });

  it('3: a capped review loop runs below the row and its escape above it', () => {
    const model: GraphModel = modelOf(fixtureFile('review-loop'));
    expect(edge(model, 'e:review->write')).toMatchObject({
      kind: 'loop',
      lane: 'below',
      max: 2,
      event: 'REVISE',
      happy: false,
    });
    expect(edge(model, 'e:review->finalize:max')).toMatchObject({
      kind: 'max',
      lane: 'above',
      max: 2,
      event: 'REVISE',
    });
    expect(edge(model, 'e:review->finalize')).toMatchObject({
      kind: 'forward',
      results: ['APPROVE'],
      happy: true,
    });
    expect(model.nodes.find((n) => n.id === 'review')?.max).toBe(2);
  });

  it('4: a shortcut spanning two ranks is a jump on the top lane, never a loop', () => {
    const model: GraphModel = modelOf(fixtureFile('shortcut-jump'));
    expect(edge(model, 'e:triage->publish')).toMatchObject({
      kind: 'jump',
      lane: 'above',
      results: ['SKIP'],
    });
    expect(model.ranks['publish']).toBe(4);
  });

  it('5: a human step is a gate node without a model', () => {
    const model: GraphModel = modelOf(fixtureFile('human-gate'));
    expect(model.nodes.find((n) => n.id === 'approve')).toMatchObject({
      kind: 'human',
      agent: 'human',
      model: null,
      max: 1,
    });
    expect(edge(model, 'e:approve->END:max')).toMatchObject({ kind: 'max', target: 'END' });
  });

  it('8: drops the dangling edge with a warning and flags the unreachable step', () => {
    const model: GraphModel = modelOf(fixtureFile('dangling-unreachable'));
    expect(model.edges.some((e: GraphEdge): boolean => e.target === 'ghost')).toBe(false);
    expect(model.nodes.find((n) => n.id === 'orphan')?.unreachable).toBe(true);
    expect(model.warnings).toEqual([
      'steps.orphan: not reachable from START',
      'fetch —FAIL→ "ghost": target is not a step or END, edge not drawn',
    ]);
  });

  it('rebuilds a structural pipeline the Studio layout ranks identically', () => {
    for (const name of FIXTURES) {
      const model: GraphModel = modelOf(fixtureFile(name));
      expect(rankPipeline(toGraphPipeline(model)).rank).toEqual(model.ranks);
    }
  });
});

describe('the graph model of every factory in factories/', () => {
  it.each(factoryIds())('%s builds without warnings and matches its snapshot', (id: string) => {
    const model: GraphModel = portable(modelOf(id));
    expect(model.warnings).toEqual([]);
    expect(graphModelSchema.parse(model)).toEqual(model);
    expect(model).toMatchSnapshot();
  });

  it('6: aws-architecture-factory is the largest and still a DAG over forward edges', () => {
    const model: GraphModel = modelOf('aws-architecture-factory');
    expect(model.stepCount).toBeGreaterThanOrEqual(25);
    for (const e of model.edges) {
      if (e.kind === 'loop')
        expect(model.ranks[e.target]!).toBeLessThanOrEqual(model.ranks[e.source]!);
      else if (e.kind !== 'max')
        expect(model.ranks[e.target]!).toBeGreaterThan(model.ranks[e.source]!);
    }
  });

  it('quick-research-factory: the review → write-report loop carries ×3 and escapes to finalize', () => {
    const model: GraphModel = modelOf('quick-research-factory');
    expect(edge(model, 'e:review->write-report')).toMatchObject({ kind: 'loop', max: 3 });
    expect(edge(model, 'e:review->finalize:max')).toMatchObject({
      kind: 'max',
      target: 'finalize',
    });
  });
});
