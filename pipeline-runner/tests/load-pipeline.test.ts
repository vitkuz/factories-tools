import { describe, expect, it } from 'vitest';
import { loadPipelineFactory } from '../src/features/pipeline/index.js';
import type { ResolvedPipeline } from '../src/features/pipeline/index.js';
import { FACTORY, ROOT, SKILL, demoDefinition, memoryFileSystem } from './helpers.js';

/** The demo factory in the factories/<id> layout: knowledge under {{factoryPath}}, one file under {{skillPath}}. */
const factoryDefinition = (): Record<string, unknown> => {
  const base: Record<string, unknown> = demoDefinition();
  const constants: Record<string, unknown> = base['constants'] as Record<string, unknown>;
  const steps: Record<string, Record<string, unknown>> = base['steps'] as Record<
    string,
    Record<string, unknown>
  >;
  return {
    ...base,
    constants: { ...constants, factoryPath: '{{rootPath}}/factories/{{id}}' },
    hooks: { before: ['cp {{factoryPath}}/pipeline.json {{outputDir}}/pipeline.json'], after: [] },
    steps: {
      ...steps,
      plan: {
        ...steps['plan'],
        knowledge: ['{{factoryPath}}/knowledge/method.md', '{{skillPath}}/SKILL.md'],
      },
    },
  };
};

const loadDemo = (): Promise<ResolvedPipeline> =>
  loadPipelineFactory({
    fileSystem: memoryFileSystem({
      [`${FACTORY}/pipeline.json`]: JSON.stringify(factoryDefinition()),
      [`${FACTORY}/knowledge/method.md`]: '# method',
      [`${SKILL}/SKILL.md`]: '# wrapper',
    }),
    now: (): Date => new Date('2026-09-17T12:00:00'),
    homeDir: (): string => '/home/me',
  })({
    pipeline: 'demo-factory',
    rootPath: ROOT,
    suppliedParams: { topic: 'Factory layout' },
  });

describe('loadPipeline in the factories/<id> layout', () => {
  it('resolves skillPath to the wrapper skill folder .claude/skills/<id>', async () => {
    const resolved: ResolvedPipeline = await loadDemo();
    expect(resolved.anchors.skillPath).toBe(SKILL);
    expect(resolved.variables['skillPath']).toBe(SKILL);
  });

  it('expands the built-in {{id}} inside the factoryPath constant', async () => {
    const resolved: ResolvedPipeline = await loadDemo();
    expect(resolved.variables['factoryPath']).toBe(FACTORY);
    expect(resolved.hooks.before).toEqual([
      `cp ${FACTORY}/pipeline.json ${resolved.outputDir}/pipeline.json`,
    ]);
  });

  it('resolves knowledge under factoryPath and skillPath to files that exist', async () => {
    const resolved: ResolvedPipeline = await loadDemo();
    expect(resolved.steps['plan']?.knowledge).toEqual([
      `${FACTORY}/knowledge/method.md`,
      `${SKILL}/SKILL.md`,
    ]);
    expect(resolved.warnings.filter((w: string): boolean => w.includes('knowledge'))).toEqual([]);
  });
});
