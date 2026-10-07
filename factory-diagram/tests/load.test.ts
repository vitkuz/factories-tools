import { describe, expect, it } from 'vitest';
import type { LoadedPipeline, ValidationOutcome } from '../src/features/load/index.js';
import { parseRawPipeline, toDefinition } from '../src/features/load/index.js';
import {
  classifyValidation,
  expandVariables,
  locateCandidates,
  upgradeLegacyPipeline,
} from '../src/features/load/load.utils.js';
import { ROOT, fixtureFile, loadReal } from './helpers.js';

describe('locating a pipeline', () => {
  it('tries the typed path, then the root-relative readings the runner tries', () => {
    const tried: string[] = locateCandidates('/repo', 'quick-research-factory', '/elsewhere');
    expect(tried[0]).toBe('/elsewhere/quick-research-factory');
    expect(tried).toContain('/repo/factories/quick-research-factory/pipeline.json');
    expect(tried).toContain('/repo/quick-research-factory/pipeline.json');
    expect(
      tried.indexOf('/repo/factories.local/quick-research-factory/pipeline.json'),
    ).toBeLessThan(tried.indexOf('/repo/factories/quick-research-factory/pipeline.json'));
  });

  it('loads a factory by id, by folder and by file', () => {
    const byId: LoadedPipeline = loadReal('quick-research-factory');
    const byFolder: LoadedPipeline = loadReal('factories/quick-research-factory');
    const byFile: LoadedPipeline = loadReal('factories/quick-research-factory/pipeline.json');
    expect(byFolder.file).toBe(byId.file);
    expect(byFile.file).toBe(byId.file);
  });

  it('names the available ids when nothing matches', () => {
    expect((): LoadedPipeline => loadReal('no-such-factory')).toThrow(/no pipeline found/);
  });
});

describe('legacy prompts', () => {
  it('splits a string prompt into lines and renames systemPrompt to system', () => {
    const upgraded = upgradeLegacyPipeline({
      steps: { plan: { prompt: 'a\nb', systemPrompt: 'who' } },
    }) as { steps: Record<string, Record<string, unknown>> };
    expect(upgraded.steps['plan']).toEqual({ prompt: ['a', 'b'], system: ['who'] });
  });

  it('loads fixture 7 through the shared validator with one legacy warning', () => {
    const loaded: LoadedPipeline = loadReal(fixtureFile('legacy-prompts'));
    expect(loaded.definition.steps['plan']?.system).toEqual(['You plan.', 'You never build.']);
    expect(loaded.warnings).toEqual([
      'legacy prompt shape (string prompt / systemPrompt) upgraded on read',
    ]);
  });
});

describe('what the validator says', () => {
  const report = (errors: string[], warnings: string[] = []) => ({
    ok: errors.length === 0,
    pipeline: 'x',
    errors,
    warnings,
  });

  it('keeps unknown-name and reachability errors as warnings, everything else fatal', () => {
    const outcome: ValidationOutcome = classifyValidation(
      report([
        'steps.orphan: not reachable from START',
        'steps.fetch.transitions.FAIL.target: "ghost" is not a step or END',
        'schema: pipeline.id: "Bad" must match ^[a-z]',
      ]),
      false,
    );
    expect(outcome.fatal).toEqual(['schema: pipeline.id: "Bad" must match ^[a-z]']);
    expect(outcome.unreachable).toEqual(['orphan']);
    expect(outcome.dangling).toEqual(['ghost']);
    expect(outcome.warnings).toEqual(['steps.orphan: not reachable from START']);
  });

  it('answers legacy shape complaints with the upgrade, only for a legacy file', () => {
    const errors: string[] = ['schema: pipeline.steps.plan.prompt: must be array, got string'];
    expect(classifyValidation(report(errors), true).fatal).toEqual([]);
    expect(classifyValidation(report(errors), false).fatal).toEqual(errors);
  });

  it('drops the wrapper-skill warning outside factories/', () => {
    const warnings: string[] = ['no wrapper skill folder /x/.claude/skills/y: …'];
    expect(classifyValidation(report([], warnings), false, false).warnings).toEqual([]);
    expect(classifyValidation(report([], warnings), false, true).warnings).toEqual(warnings);
  });

  it('refuses a pipeline the shared validator finds invalid', () => {
    expect((): LoadedPipeline => loadReal(fixtureFile('../tests/not-a-pipeline.json'))).toThrow();
  });
});

describe('resolving constants like the runner', () => {
  it('expands constants over anchors and the built-in id; leaves date and empty params as written', () => {
    const loaded: LoadedPipeline = loadReal('quick-research-factory');
    expect(loaded.variables['factoryPath']).toBe(`${ROOT}/factories/quick-research-factory`);
    expect(loaded.variables['skillPath']).toBe(`${ROOT}/.claude/skills/quick-research-factory`);
    expect(loaded.variables['homePath']).toBe('/home/me');
    expect(loaded.variables['sub_questions']).toBe('5');
    expect(loaded.variables).not.toHaveProperty('topic');
    expect(loaded.outputDir).toBe(
      `${ROOT}/run/quick-research-factory/quick-research-factory-{{date}}`,
    );
  });

  it('reports a cycle between variables instead of looping', () => {
    const { cycles } = expandVariables({ a: '{{b}}', b: '{{a}}' }, new Set());
    expect(cycles).toContain('a -> b -> a');
  });

  it('types a well-formed document and refuses a malformed one with the path of the issue', () => {
    const raw = parseRawPipeline('x.json', JSON.stringify({ id: 'x' }));
    expect(() => toDefinition(raw)).toThrow(/does not match the pipeline schema/);
  });
});
