import { describe, expect, it } from 'vitest';
import {
  checkDefinition,
  definitionIssues,
  definitionWarnings,
  resolvePipeline,
  verifyWorkspaceFactory,
} from '../src/features/pipeline/services/index.js';
import type { ResolvedPipeline } from '../src/features/pipeline/index.js';
import { isAppError } from '../src/shared/utils/error.utils.js';
import { context, demoDefinition, load, memoryFileSystem, ROOT } from './helpers.js';

const issuesOf = (run: () => unknown): string[] => {
  try {
    run();
  } catch (error) {
    if (isAppError(error)) return error.issues;
    throw error;
  }
  return [];
};

describe('resolvePipeline', () => {
  const resolved: ResolvedPipeline = resolvePipeline(context())(load());

  it('derives slug from the main param and anchors outputDir on the root', () => {
    expect(resolved.variables['slug']).toBe('how-to-build-an-ai-dark-factory');
    expect(resolved.outputDir).toBe(
      `${ROOT}/run/demo-factory/how-to-build-an-ai-dark-factory-2026-09-17`,
    );
  });

  it('never lets cwd, . or ~ through', () => {
    expect(resolved.variables['rootPath']).toBe(ROOT);
    expect(resolved.variables['skillPath']).toBe('/repo/.claude/skills/demo-factory');
    expect(resolved.variables['homePath']).toBe('/home/me');
  });

  it('expands constants built on other variables', () => {
    expect(resolved.variables['sitePath']).toBe(`${ROOT}/websites/how-to-build-an-ai-dark-factory`);
    expect(resolved.steps['build']?.workDir).toBe(
      `${ROOT}/websites/how-to-build-an-ai-dark-factory`,
    );
  });

  it('fills prompts, keeps defaults, and makes every path absolute', () => {
    expect(resolved.steps['plan']?.prompt).toBe('Plan How to Build an AI Dark Factory at depth 2.');
    expect(resolved.steps['build']?.systemPrompt).toBe('You build demo-factory.');
    expect(resolved.steps['plan']?.output).toEqual([`${resolved.outputDir}/1-plan/outline.md`]);
    expect(resolved.steps['review']?.input).toEqual([`${resolved.outputDir}/3-build/*.md`]);
    expect(resolved.steps['plan']?.knowledge).toEqual([`${ROOT}/knowledge/outline.md`]);
    expect(resolved.steps['design']?.workDir).toBe(resolved.outputDir);
    expect(resolved.hooks.before).toEqual([`echo before ${resolved.outputDir}`]);
  });

  it('is deterministic', () => {
    expect(resolvePipeline(context())(load())).toEqual(resolved);
  });

  it('treats what the user typed as data, not as a template', () => {
    const typed = resolvePipeline(context({ suppliedParams: { topic: '{{homePath}}' } }))(load());
    expect(typed.steps['plan']?.prompt).toBe('Plan {{homePath}} at depth 2.');
  });

  it('coerces a supplied param to the type of its default and honours a pinned slug', () => {
    const pinned = resolvePipeline(
      context({ slug: 'pinned', suppliedParams: { topic: 'x', depth: '5' } }),
    )(load());
    expect(pinned.params).toEqual({ topic: 'x', depth: 5 });
    expect(pinned.variables['slug']).toBe('pinned');
  });

  it('refuses a missing required param, an unknown param and a mistyped one — all at once', () => {
    const issues: string[] = issuesOf(() =>
      resolvePipeline(context({ suppliedParams: { nope: '1', depth: 'deep' } }))(load()),
    );
    expect(issues).toHaveLength(3);
  });

  it('refuses variables that refer to each other in a circle', () => {
    const definition = demoDefinition();
    Object.assign(definition['constants'] as object, { a: '{{b}}', b: '{{a}}' });
    expect(issuesOf(() => resolvePipeline(context())(load(definition)))[0]).toContain(
      'a -> b -> a',
    );
  });

  it('refuses an outputDir that names itself', () => {
    const definition = { ...demoDefinition(), outputDir: '{{outputDir}}/x' };
    expect(issuesOf(() => resolvePipeline(context())(load(definition)))[0]).toContain('outputDir');
  });
});

describe('checkDefinition', () => {
  it('passes a sound graph through untouched', () => {
    expect(checkDefinition(load())).toEqual(load());
  });

  it('reports unknown targets, unknown placeholders and unreachable steps', () => {
    const definition = demoDefinition();
    const steps = definition['steps'] as Record<string, Record<string, unknown>>;
    steps['design'] = {
      ...steps['design'],
      prompt: ['Design {{nothing}}.'],
      transitions: { DONE: { target: ['ghost'] } },
    };
    steps['island'] = {
      agent: 'general-purpose',
      prompt: ['x'],
      transitions: { DONE: { target: ['END'] } },
    };
    const issues: string[] = definitionIssues(load(definition).definition);
    expect(issues.some((issue: string): boolean => issue.includes('"ghost"'))).toBe(true);
    expect(issues.some((issue: string): boolean => issue.includes('{{nothing}}'))).toBe(true);
    expect(issues.some((issue: string): boolean => issue.includes('"island" is unreachable'))).toBe(
      true,
    );
  });

  it('warns about a loop no max bounds', () => {
    const definition = demoDefinition();
    const steps = definition['steps'] as Record<string, Record<string, unknown>>;
    steps['review'] = {
      ...steps['review'],
      transitions: { APPROVE: { target: ['END'] }, REVISE: { target: ['build'] } },
    };
    expect(definitionWarnings(load(definition).definition).join('\n')).toContain('no "max" bounds');
  });

  it('refuses a shape the schema forbids', () => {
    const definition = { ...demoDefinition(), extra: true };
    expect(issuesOf(() => load(definition)).length).toBeGreaterThan(0);
  });
});

describe('verifyWorkspace', () => {
  const withAgent = (): ResolvedPipeline => {
    const definition = demoDefinition();
    const steps = definition['steps'] as Record<string, Record<string, unknown>>;
    steps['review'] = { ...steps['review'], agent: 'strict-reviewer' };
    return resolvePipeline(context())(load(definition));
  };

  it('passes a ready workspace through with no warnings', async () => {
    const fileSystem = memoryFileSystem({
      [`${ROOT}/.claude/settings.json`]: '{}',
      [`${ROOT}/.claude/agents/strict-reviewer.md`]: '# strict',
      [`${ROOT}/knowledge/outline.md`]: 'Shape the outline.',
    });
    expect((await verifyWorkspaceFactory(fileSystem)(withAgent())).warnings).toEqual([]);
  });

  it('warns about a missing knowledge file and a missing agent profile, and carries on', async () => {
    const fileSystem = memoryFileSystem({ [`${ROOT}/.claude/settings.json`]: '{}' });
    const verified: ResolvedPipeline = await verifyWorkspaceFactory(fileSystem)(withAgent());

    expect(verified.warnings).toHaveLength(2);
    expect(verified.warnings[0]).toContain(`plan.knowledge: ${ROOT}/knowledge/outline.md`);
    expect(verified.warnings[1]).toContain('agent "strict-reviewer" has no profile');
    expect(verified.warnings[1]).toContain('stand in for review');
    expect(verified.steps).toEqual(withAgent().steps);
  });

  it('finds an agent profile in the home folder too', async () => {
    const fileSystem = memoryFileSystem({
      [`${ROOT}/.claude/settings.json`]: '{}',
      '/home/me/.claude/agents/strict-reviewer.md': '# strict',
      [`${ROOT}/knowledge/outline.md`]: 'Shape the outline.',
    });
    expect((await verifyWorkspaceFactory(fileSystem)(withAgent())).warnings).toEqual([]);
  });

  it('still refuses a root that holds no .claude/', async () => {
    const issues: string[] = await verifyWorkspaceFactory(memoryFileSystem())(withAgent()).then(
      (): string[] => [],
      (error: unknown): string[] => (isAppError(error) ? error.issues : []),
    );
    expect(issues[0]).toContain('holds no .claude/');
  });
});
