import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  expandConstants,
  knowledgeBase,
  legacyKnowledgeCandidates,
  type KnowledgeBase,
} from '../src/features/pipelines/pipelines.utils.js';

describe('expandConstants', () => {
  it('expands a constant that points at another template, leaving the anchors', () => {
    expect(
      expandConstants('{{knowledgePath}}/routing.md', {
        rootPath: 'cwd',
        knowledgePath: '{{rootPath}}/knowledge/strategy',
      }),
    ).toBe('{{rootPath}}/knowledge/strategy/routing.md');
  });

  it('follows nested constants and leaves unknown names alone', () => {
    expect(expandConstants('{{b}}/{{nope}}.md', { a: 'x', b: '{{a}}/y' })).toBe('x/y/{{nope}}.md');
  });

  it('stops on a cycle', () => {
    expect(typeof expandConstants('{{a}}', { a: '{{a}}/z' })).toBe('string');
  });
});

describe('knowledgeBase', () => {
  it('resolves a {{knowledgePath}} doc against the root', () => {
    const result: KnowledgeBase = knowledgeBase('{{knowledgePath}}/framework-routing.md', {
      workDir: '/work',
      pipelineDir: '/work/factories/s',
      pipeline: { constants: { rootPath: 'cwd', knowledgePath: '{{rootPath}}/knowledge/sr' } },
    });
    expect(result).toEqual({
      base: path.resolve('/work'),
      rest: 'knowledge/sr/framework-routing.md',
    });
  });

  it('resolves a {{factoryPath}} doc (built on {{rootPath}} and {{id}}) inside factories/<id>', () => {
    const result: KnowledgeBase = knowledgeBase('{{factoryPath}}/knowledge/method.md', {
      workDir: '/work',
      pipelineDir: '/work/factories/demo',
      pipeline: {
        id: 'demo',
        constants: {
          rootPath: 'cwd',
          skillPath: '.',
          factoryPath: '{{rootPath}}/factories/{{id}}',
        },
      },
    });
    expect(result).toEqual({
      base: path.resolve('/work'),
      rest: 'factories/demo/knowledge/method.md',
    });
  });

  it('resolves a {{skillPath}} doc against the wrapper skill folder .claude/skills/<id>', () => {
    const result: KnowledgeBase = knowledgeBase('{{skillPath}}/SKILL.md', {
      workDir: '/work',
      pipelineDir: '/work/factories/demo',
      pipeline: { id: 'demo', constants: { rootPath: 'cwd', skillPath: '.' } },
    });
    expect(result).toEqual({ base: path.resolve('/work/.claude/skills/demo'), rest: 'SKILL.md' });
  });

  it('resolves a path with no template against the folder holding pipeline.json', () => {
    const result: KnowledgeBase = knowledgeBase('knowledge/local.md', {
      workDir: '/work',
      pipelineDir: '/work/factories/demo',
      pipeline: { id: 'demo', constants: { rootPath: 'cwd' } },
    });
    expect(result).toEqual({ base: '/work/factories/demo', rest: 'knowledge/local.md' });
  });
});

describe('legacyKnowledgeCandidates', () => {
  it('yields every suffix, longest first', () => {
    expect(legacyKnowledgeCandidates(['knowledge', 'frameworks', 'x.md'])).toEqual([
      ['knowledge', 'frameworks', 'x.md'],
      ['frameworks', 'x.md'],
      ['x.md'],
    ]);
  });
  it('is empty for no segments and does not touch its input', () => {
    const input: string[] = ['a.md'];
    expect(legacyKnowledgeCandidates([])).toEqual([]);
    expect(legacyKnowledgeCandidates(input)).toEqual([['a.md']]);
    expect(input).toEqual(['a.md']);
  });
});
