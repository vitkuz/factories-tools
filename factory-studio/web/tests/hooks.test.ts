import { describe, expect, it } from 'vitest';
import {
  expandPlaceholders,
  hookSegments,
  resolveHookPath,
  tokenizeHook,
  type HookConstants,
} from '../src/features/runs/hooks.utils';
import type { HookSegment } from '../src/features/runs/runs.types';

const shared: HookConstants = {
  rootPath: 'cwd',
  homePath: '~',
  factoryPath: '{{rootPath}}/factories/{{id}}',
  knowledgePath: '{{factoryPath}}/knowledge',
};
const local: HookConstants = {
  ...shared,
  factoryPath: '{{rootPath}}/factories.local/{{id}}',
  lintBin: '{{rootPath}}/tools/lint/cli.js',
};

const BEFORE = 'cp {{factoryPath}}/pipeline.json {{outputDir}}/pipeline.json';
const AFTER = 'bash {{rootPath}}/factories/scripts/ai-usage-ingest.sh {{outputDir}}';

const chips = (s: HookSegment[]): string[] =>
  s.filter((x: HookSegment): boolean => x.target !== null).map((x: HookSegment): string => x.text);

describe('tokenizeHook', () => {
  it('keeps a whole templated path as one token and gives the command back', () => {
    const t = tokenizeHook(AFTER);
    expect(t.filter((x) => x.path).map((x) => x.text)).toEqual([
      '{{rootPath}}/factories/scripts/ai-usage-ingest.sh',
      '{{outputDir}}',
    ]);
    expect(t.map((x) => x.text).join('')).toBe(AFTER);
  });

  it('leaves quotes and shell punctuation outside the token', () => {
    const t = tokenizeHook('node "{{factoryPath}}/a.mjs";');
    expect(t.filter((x) => x.path).map((x) => x.text)).toEqual(['{{factoryPath}}/a.mjs']);
  });

  it('skips flags and URLs', () => {
    expect(tokenizeHook('curl --out=a/b https://x.io/y').some((x) => x.path)).toBe(false);
  });
});

describe('expandPlaceholders', () => {
  it('expands constants and {{id}}, keeps the anchors', () => {
    expect(expandPlaceholders(shared, 'f')('{{knowledgePath}}/x.md')).toBe(
      '{{rootPath}}/factories/f/knowledge/x.md',
    );
    expect(expandPlaceholders(shared, 'f')('{{outputDir}}/x')).toBe('{{outputDir}}/x');
  });

  it('leaves an unknown placeholder as written', () => {
    expect(expandPlaceholders(shared, 'f')('{{nope}}/x')).toBe('{{nope}}/x');
  });

  it('stops on a cycle', () => {
    expect(expandPlaceholders({ a: '{{a}}/x' }, 'f')('{{a}}').length).toBeGreaterThan(0);
  });
});

describe('resolveHookPath', () => {
  it('before hook: {{factoryPath}}/pipeline.json opens the factory pipeline', () => {
    expect(resolveHookPath(shared, 'mck')('{{factoryPath}}/pipeline.json')).toEqual({
      scope: 'knowledge',
      path: '{{rootPath}}/factories/mck/pipeline.json',
    });
  });

  it('after hook: the full {{rootPath}} path, not just scripts/…', () => {
    expect(
      resolveHookPath(shared, 'mck')('{{rootPath}}/factories/scripts/ai-usage-ingest.sh'),
    ).toEqual({
      scope: 'knowledge',
      path: '{{rootPath}}/factories/scripts/ai-usage-ingest.sh',
    });
  });

  it('a local factory resolves under factories.local', () => {
    expect(resolveHookPath(local, 'klevrs')('{{factoryPath}}/scripts/check.mjs')).toEqual({
      scope: 'knowledge',
      path: '{{rootPath}}/factories.local/klevrs/scripts/check.mjs',
    });
    expect(resolveHookPath(local, 'klevrs')('{{lintBin}}')?.path).toBe(
      '{{rootPath}}/tools/lint/cli.js',
    );
  });

  it('{{outputDir}}/file is a run document; a bare {{outputDir}} is not a chip', () => {
    expect(resolveHookPath(shared, 'f')('{{outputDir}}/pipeline.json')).toEqual({
      scope: 'run',
      path: 'pipeline.json',
    });
    expect(resolveHookPath(shared, 'f')('{{outputDir}}')).toBeNull();
    expect(resolveHookPath(shared, 'f')('{{rootPath}}')).toBeNull();
  });

  it('an unknown placeholder stays text', () => {
    expect(resolveHookPath(shared, 'f')('{{decision_makers}}')).toBeNull();
    expect(resolveHookPath(shared, 'f')('{{nope}}/x.md')).toBeNull();
  });

  it('refuses a .. escape, even one that comes from a constant', () => {
    expect(resolveHookPath(shared, 'f')('{{rootPath}}/../etc/passwd')).toBeNull();
    expect(
      resolveHookPath({ ...shared, evil: '../..' }, 'f')('{{rootPath}}/{{evil}}/x.md'),
    ).toBeNull();
    expect(resolveHookPath(shared, 'f')('{{outputDir}}/../x.md')).toBeNull();
  });

  it('refuses paths outside the work dir', () => {
    expect(resolveHookPath(shared, 'f')('/etc/passwd')).toBeNull();
    expect(resolveHookPath(shared, 'f')('{{homePath}}/x.md')).toBeNull();
  });

  it('a plain relative file is a work-dir file', () => {
    expect(resolveHookPath(shared, 'f')('scripts/x.sh')).toEqual({
      scope: 'knowledge',
      path: '{{rootPath}}/scripts/x.sh',
    });
  });
});

describe('hookSegments', () => {
  const seg = hookSegments(shared, 'mck');

  it('before hook: two whole-token chips', () => {
    expect(chips(seg(BEFORE))).toEqual([
      '{{factoryPath}}/pipeline.json',
      '{{outputDir}}/pipeline.json',
    ]);
  });

  it('after hook: one chip over the whole script path, bare {{outputDir}} stays text', () => {
    const s: HookSegment[] = seg(AFTER);
    expect(chips(s)).toEqual(['{{rootPath}}/factories/scripts/ai-usage-ingest.sh']);
    expect(s.map((x) => x.text).join('')).toBe(AFTER);
  });

  it('an unresolvable token is merged into the surrounding text', () => {
    const s: HookSegment[] = seg('echo {{nope}}/x.md ok');
    expect(s).toEqual([{ text: 'echo {{nope}}/x.md ok', target: null }]);
  });
});
