import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFileSystemAdapter } from '../src/adapters/file-system/index.js';
import { createShellAdapter } from '../src/adapters/shell/index.js';
import {
  drawFactory,
  indexMarkdown,
  namesFile,
  outputDirForAll,
  outputFileFor,
  type Draw,
  type DrawReport,
} from '../src/features/draw/index.js';
import { loadPipelineFactory } from '../src/features/load/index.js';
import { renderOptionsSchema } from '../src/features/render/render.schema.js';
import type { RenderOptions } from '../src/features/render/render.types.js';
import { ROOT, fixtureFile } from './helpers.js';

const options: RenderOptions = renderOptionsSchema.parse({ version: 'test' });
const quiet = {
  debug: (): void => {},
  info: (): void => {},
  warn: (): void => {},
  error: (): void => {},
};

const draw = (): Draw =>
  drawFactory({
    fileSystem: createFileSystemAdapter(),
    loadPipeline: loadPipelineFactory({
      fileSystem: createFileSystemAdapter(),
      shell: createShellAdapter(),
    }),
    renderers: {
      native: (): { svg: string; warnings: string[] } => ({ svg: '<svg/>', warnings: [] }),
    },
    logger: quiet,
  });

describe('where a diagram lands', () => {
  it('defaults to <root>/<id>.svg, a folder for --out <dir>, the exact file for --out <file>', () => {
    expect(outputFileFor('/repo', 'x', 'svg', undefined)).toBe('/repo/x.svg');
    expect(outputFileFor('/repo', 'x', 'svg', 'docs/diagrams')).toBe('/repo/docs/diagrams/x.svg');
    expect(outputFileFor('/repo', 'x', 'svg', 'ideas/pic.svg')).toBe('/repo/ideas/pic.svg');
    expect(outputFileFor('/repo', 'x', 'json', undefined)).toBe('/repo/x.graph.json');
    expect(namesFile('out.json', 'json')).toBe(true);
    expect(outputDirForAll('/repo', undefined)).toBe('/repo/diagrams');
  });

  it('lists every file in index.md with relative links', () => {
    const md: string = indexMarkdown(
      [{ id: 'a', file: '/repo/diagrams/a.svg', changed: true, warnings: [] }],
      '/repo/diagrams',
    );
    expect(md).toContain('- [a](./a.svg)');
    expect(md).toContain('![a](./a.svg)');
  });
});

describe('drawing', () => {
  const scratch: string = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-diagram-'));

  it('writes the model as JSON and reports an unchanged second run', () => {
    const request = {
      pipeline: fixtureFile('linear'),
      all: false,
      rootPath: ROOT,
      out: path.join(scratch, 'linear.graph.json'),
      format: 'json' as const,
      options,
      strict: false,
    };
    const first: DrawReport = draw()(request);
    const second: DrawReport = draw()(request);
    expect(first.files[0]?.changed).toBe(true);
    expect(second.files[0]?.changed).toBe(false);
    expect(JSON.parse(fs.readFileSync(first.files[0]!.file, 'utf8'))).toMatchObject({
      id: 'linear',
    });
  });

  it('refuses warnings under --strict', () => {
    expect(() =>
      draw()({
        pipeline: fixtureFile('dangling-unreachable'),
        all: false,
        rootPath: ROOT,
        out: scratch,
        format: 'json',
        options,
        strict: true,
      }),
    ).toThrow(/warnings are errors/);
  });

  it('--all draws every factory into one folder with an index', () => {
    const report: DrawReport = draw()({
      all: true,
      rootPath: ROOT,
      out: path.join(scratch, 'all'),
      format: 'svg',
      options,
      strict: true,
    });
    expect(report.files.length).toBeGreaterThanOrEqual(10);
    expect(report.index).toBe(path.join(scratch, 'all', 'index.md'));
    expect(fs.existsSync(path.join(scratch, 'all', 'quick-research-factory.svg'))).toBe(true);
  });

  it('--all refuses a file name for --out', () => {
    expect(() =>
      draw()({ all: true, rootPath: ROOT, out: 'x.svg', format: 'svg', options, strict: false }),
    ).toThrow(/must be a folder/);
  });
});
