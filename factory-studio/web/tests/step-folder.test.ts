import { describe, expect, it } from 'vitest';
import { runSitePath, runZipPath } from '../src/adapters/http/api-paths';
import type { StepNodeData } from '../src/features/runs/lib/graph';
import { stepFolderOf, stepFolderReady } from '../src/features/runs/runs.utils';

const RUN = { pipelineId: 'p', runId: 'r' };

describe('stepFolderOf', () => {
  it.each([
    [['1-get-lead/lead.json', '1-get-lead/audit.md'], '1-get-lead'],
    [['run/p/r/2-x/a.md'], '2-x'],
    [['./3-y/*.md'], '3-y'],
    [['4-z/deep/a.md', '4-z/b.md'], '4-z'],
    [['1-a/x.md', '2-b/y.md'], null],
    [[], null],
    [['*/x.md'], null],
    [['{{outputDir}}/x.md'], null],
    [['report.md'], null],
    [['../up/x.md'], null],
  ])('%j -> %s', (outputs: string[], folder: string | null) => {
    expect(stepFolderOf(RUN, outputs)).toBe(folder);
  });
});

type ReadyData = Pick<StepNodeData, 'hasState' | 'status' | 'outputsFromPipeline'>;

describe('stepFolderReady', () => {
  it.each([
    [{ hasState: false, status: 'none', outputsFromPipeline: true }, false],
    [{ hasState: true, status: 'none', outputsFromPipeline: true }, false],
    [{ hasState: true, status: 'PENDING', outputsFromPipeline: true }, false],
    [{ hasState: true, status: 'SKIPPED', outputsFromPipeline: true }, false],
    [{ hasState: true, status: 'RUNNING', outputsFromPipeline: true }, true],
    [{ hasState: true, status: 'waiting', outputsFromPipeline: true }, true],
    [{ hasState: true, status: 'COMPLETED', outputsFromPipeline: true }, true],
    [{ hasState: true, status: 'PENDING', outputsFromPipeline: false }, true],
  ] as [ReadyData, boolean][])('%j -> %s', (data: ReadyData, ready: boolean) => {
    expect(stepFolderReady(data)).toBe(ready);
  });
});

describe('run folder links', () => {
  it('end in / and encode each part', () => {
    expect(runSitePath('p', 'r', '1-get lead')).toBe('/api/v1/site/p/r/1-get%20lead/');
    expect(runZipPath('p', 'r', '1-get lead')).toBe('/api/v1/zip/p/r/1-get%20lead/');
    expect(runSitePath('a b', 'r#1', 'x')).toBe('/api/v1/site/a%20b/r%231/x/');
  });
});
