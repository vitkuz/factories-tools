import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFileSystemAdapter } from '../src/adapters/file-system/index.js';
import { createShellAdapter } from '../src/adapters/shell/index.js';
import { buildGraph, type GraphModel } from '../src/features/graph/index.js';
import { loadPipelineFactory, type LoadedPipeline } from '../src/features/load/index.js';

export const TOOL_DIR: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The repository root: where factories/ and .claude/skills/any-factory live. */
export const ROOT: string = path.resolve(TOOL_DIR, '..', '..');
export const FIXTURES: string = path.join(TOOL_DIR, 'fixtures');

export const fixtureFile = (name: string): string => path.join(FIXTURES, name, 'pipeline.json');

/** The real loader against the real validator — the shared gate is part of what is under test. */
export const loadReal = (reference: string): LoadedPipeline =>
  loadPipelineFactory({
    fileSystem: createFileSystemAdapter(),
    shell: createShellAdapter(),
    homeDir: (): string => '/home/me',
  })({ pipeline: reference, rootPath: ROOT });

export const modelOf = (reference: string): GraphModel => buildGraph(loadReal(reference));

/** Absolute paths out of the model so a snapshot reads the same on every machine. */
export const portable = (model: GraphModel): GraphModel =>
  JSON.parse(JSON.stringify(model).split(ROOT).join('<root>')) as GraphModel;
