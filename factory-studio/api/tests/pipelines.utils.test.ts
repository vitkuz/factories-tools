import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  expandConstants,
  extractDescription,
  extractParams,
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

describe('extractParams', () => {
  it('types every param by its default, in declaration order; empty default = required, first = main', () => {
    expect(
      extractParams({
        params: { topic: '', sub_questions: 5, language: 'English', dry_run: false },
      }),
    ).toEqual([
      { name: 'topic', type: 'string', default: '', required: true, main: true },
      { name: 'sub_questions', type: 'number', default: 5, required: false, main: false },
      { name: 'language', type: 'string', default: 'English', required: false, main: false },
      { name: 'dry_run', type: 'boolean', default: false, required: false, main: false },
    ]);
  });

  it('drops a bad name or a default that is not a scalar, but the main param stays the first declared', () => {
    expect(
      extractParams({ params: { list: ['a'], 'bad name': 'x', nested: { a: 1 }, label: 'ok' } }),
    ).toEqual([{ name: 'label', type: 'string', default: 'ok', required: false, main: false }]);
  });

  it('is empty when there are no params, or they are not an object', () => {
    expect(extractParams({ id: 'x' })).toEqual([]);
    expect(extractParams({ params: ['a'] })).toEqual([]);
    expect(extractParams(null)).toEqual([]);
  });
});

describe('extractDescription', () => {
  it('a non-empty string, trimmed; otherwise nothing', () => {
    expect(extractDescription({ description: '  Answers one question.  ' })).toBe(
      'Answers one question.',
    );
    expect(extractDescription({ description: '   ' })).toBeUndefined();
    expect(extractDescription({ description: 3 })).toBeUndefined();
    expect(extractDescription({})).toBeUndefined();
  });
});
