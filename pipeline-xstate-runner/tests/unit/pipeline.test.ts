import { afterAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { createFileSystemClient } from '../../src/clients/file-system/client.js';
import {
  buildVariables,
  deriveSlug,
} from '../../src/features/pipeline/services/build-variables.service.js';
import { loadPipelineFactory } from '../../src/features/pipeline/services/load-pipeline.service.js';
import { locatePipelineFactory } from '../../src/features/pipeline/services/locate-pipeline.service.js';
import { resolveParams } from '../../src/features/pipeline/services/resolve-params.service.js';
import { resolvePipeline } from '../../src/features/pipeline/services/resolve-pipeline.service.js';
import type { Pipeline } from '../../src/features/pipeline/pipeline.types.js';
import { valueOf } from '../../src/shared/utils/result.utils.js';
import { fixtureProject } from '../helpers.js';

const fileSystem = createFileSystemClient();
const project = fixtureProject(['linear', 'condition']);
afterAll(() => project.remove());

const pipeline = (): Pipeline => ({
  id: 'demo',
  constants: {
    rootPath: 'cwd',
    skillPath: '.',
    homePath: '~',
    factoryPath: '{{rootPath}}/factories/{{id}}',
    data: '{{outputDir}}/data',
  },
  params: { topic: '', count: 3, strict: false, lang: 'en' },
  outputDir: '{{rootPath}}/run/{{id}}/{{slug}}-{{date}}',
  START: ['a'],
  steps: {
    a: {
      agent: 'general-purpose',
      prompt: ['Write about {{topic}} in {{lang}}, {{count}} times.'],
      knowledge: ['{{factoryPath}}/knowledge/k.md'],
      input: ['1-a/in.md'],
      output: ['1-a/out.md'],
      workDir: 'scratch/{{slug}}',
      transitions: { DONE: { target: ['END'] } },
    },
  },
});

describe('resolveParams', () => {
  it("coerces a value to its default's type and keeps the defaults", () => {
    expect(
      valueOf(resolveParams(pipeline())({ topic: 'Cats & Dogs', count: '5', strict: 'yes' })),
    ).toEqual({
      topic: 'Cats & Dogs',
      count: 5,
      strict: true,
      lang: 'en',
    });
  });

  it('refuses an unknown param, a misfit value and a missing required one, each by name', () => {
    expect(resolveParams(pipeline())({ topic: 't', nope: '1' })).toMatchObject({
      ok: false,
      refusal: { guard: 'param-known' },
    });
    expect(resolveParams(pipeline())({ topic: 't', count: 'many' })).toMatchObject({
      ok: false,
      refusal: { guard: 'param-fits-type' },
    });
    expect(resolveParams(pipeline())({ topic: 't', count: '1.5' })).toMatchObject({
      ok: false,
      refusal: { guard: 'param-fits-type' },
    });
    expect(resolveParams(pipeline())({})).toMatchObject({
      ok: false,
      refusal: { guard: 'param-has-value' },
    });
  });
});

describe('buildVariables', () => {
  const context = {
    anchors: { rootPath: '/repo', skillPath: '/repo/.claude/skills/demo', homePath: '/home/me' },
    date: '2026-10-07',
    suppliedParams: {},
  };

  it('resolves anchors, built-ins, constants built on anchors, and outputDir last', () => {
    const variables = buildVariables(context)(pipeline(), {
      topic: 'Cats & Dogs',
      count: 3,
      strict: false,
      lang: 'en',
    });
    expect(variables).toMatchObject({
      rootPath: '/repo',
      skillPath: '/repo/.claude/skills/demo',
      homePath: '/home/me',
      id: 'demo',
      slug: 'cats-dogs',
      date: '2026-10-07',
      factoryPath: '/repo/factories/demo',
      outputDir: '/repo/run/demo/cats-dogs-2026-10-07',
      data: '/repo/run/demo/cats-dogs-2026-10-07/data',
      count: '3',
    });
  });

  it('slug is the main param in kebab-case, the id when there is none', () => {
    expect(deriveSlug(pipeline(), { topic: 'How to Build an AI Dark Factory' })).toBe(
      'how-to-build-an-ai-dark-factory',
    );
    expect(deriveSlug({ ...pipeline(), params: undefined }, {})).toBe('demo');
  });
});

describe('resolvePipeline', () => {
  it('fills every step: input/output under the run folder, knowledge and workDir under the root', () => {
    const resolved = valueOf(
      resolvePipeline({
        anchors: {
          rootPath: '/repo',
          skillPath: '/repo/.claude/skills/demo',
          homePath: '/home/me',
        },
        date: '2026-10-07',
        suppliedParams: { topic: 'cats' },
      })('/repo/factories/demo/pipeline.json', pipeline()),
    );
    expect(resolved.outputDir).toBe('/repo/run/demo/cats-2026-10-07');
    expect(resolved.steps['a']).toMatchObject({
      prompt: 'Write about cats in en, 3 times.',
      knowledge: ['/repo/factories/demo/knowledge/k.md'],
      input: ['/repo/run/demo/cats-2026-10-07/1-a/in.md'],
      output: ['/repo/run/demo/cats-2026-10-07/1-a/out.md'],
      workDir: '/repo/scratch/cats',
      isHuman: false,
    });
  });
});

describe('locatePipeline', () => {
  const locate = locatePipelineFactory(fileSystem)(project.root, project.root);

  it('finds an id under factories.local first, then factories, and a path or folder', () => {
    expect(valueOf(locate('linear'))).toBe(
      path.join(project.root, 'factories.local', 'linear', 'pipeline.json'),
    );
    expect(valueOf(locate('quick-research-factory'))).toBe(
      path.join(project.root, 'factories', 'quick-research-factory', 'pipeline.json'),
    );
    expect(valueOf(locate('factories.local/condition'))).toBe(
      path.join(project.root, 'factories.local', 'condition', 'pipeline.json'),
    );
    expect(locate('no-such-factory')).toMatchObject({
      ok: false,
      refusal: { guard: 'pipeline-found' },
    });
  });

  it('loads and shape-checks the file', () => {
    expect(valueOf(loadPipelineFactory(fileSystem)(valueOf(locate('linear')))).id).toBe('linear');
  });
});
