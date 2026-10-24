import { describe, expect, it } from 'vitest';
import type { WorkspacesFile } from '../src/features/workspaces/workspaces.types.js';
import {
  formatWorkspacesFile,
  slugify,
  withWorkspace,
  withoutWorkspace,
} from '../src/features/workspaces/workspaces.utils.js';
import { workspaceIdSchema } from '../src/features/workspaces/workspaces.schema.js';

describe('slugify', () => {
  it.each([
    ['Klevrs', 'klevrs'],
    ['Klevrs Sales', 'klevrs-sales'],
    ['  Research / Deep!! ', 'research-deep'],
    ['--a__b--', 'a-b'],
    ['Q4 2026', 'q4-2026'],
    ['Исследования', 'workspace'],
    ['Клеврс 2', '2'],
    ['!!!', 'workspace'],
    ['', 'workspace'],
  ])('%j -> %j', (name: string, id: string) => {
    expect(slugify(name)).toBe(id);
  });

  it('cuts to 60 characters and never ends on a dash', () => {
    const id: string = slugify(`${'a'.repeat(59)} b`);
    expect(id).toBe('a'.repeat(59));
    expect(slugify('x'.repeat(100))).toHaveLength(60);
  });

  it('always yields a valid workspace id', () => {
    for (const name of ['A', ' a b ', 'é', `${'z'.repeat(70)}`, '9 lives', '-x-']) {
      expect(workspaceIdSchema.safeParse(slugify(name)).success).toBe(true);
    }
  });
});

describe('formatWorkspacesFile', () => {
  it('is pretty JSON with 2 spaces and a trailing newline', () => {
    const file: WorkspacesFile = {
      workspaces: [{ id: 'a', name: 'A', pipelines: ['p-1', 'p-2'] }],
    };
    expect(formatWorkspacesFile(file)).toBe(`${JSON.stringify(file, null, 2)}\n`);
    expect(formatWorkspacesFile({ workspaces: [] })).toBe('{\n  "workspaces": []\n}\n');
  });
});

describe('withWorkspace / withoutWorkspace', () => {
  const file: WorkspacesFile = {
    workspaces: [
      { id: 'a', name: 'A', pipelines: [] },
      { id: 'b', name: 'B', pipelines: ['p'] },
    ],
  };

  it('replaces in place, appends when new, and never mutates', () => {
    expect(withWorkspace(file, { id: 'a', name: 'A2', pipelines: ['q'] }).workspaces).toEqual([
      { id: 'a', name: 'A2', pipelines: ['q'] },
      { id: 'b', name: 'B', pipelines: ['p'] },
    ]);
    expect(
      withWorkspace(file, { id: 'c', name: 'C', pipelines: [] }).workspaces.map(
        (w: { id: string }): string => w.id,
      ),
    ).toEqual(['a', 'b', 'c']);
    expect(withoutWorkspace(file, 'a').workspaces).toEqual([
      { id: 'b', name: 'B', pipelines: ['p'] },
    ]);
    expect(file.workspaces).toHaveLength(2);
    expect(file.workspaces[0]?.name).toBe('A');
  });
});
