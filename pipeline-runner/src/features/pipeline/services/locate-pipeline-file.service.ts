import path from 'node:path';
import type { FileSystemAdapter } from '../../../adapters/file-system/index.js';
import { createAppError } from '../../../shared/utils/error.utils.js';

const PIPELINE_FILE = 'pipeline.json';
/**
 * Factory graphs live at `<root>/factories.local/<id>/pipeline.json` (the project's own) or
 * `<root>/factories/<id>/pipeline.json` (the shared kit); `.claude/skills/<id>/` only wraps them.
 */
const FACTORY_DIRS: readonly string[] = ['factories.local', 'factories'];

/** Where `reference` may live, most literal reading first. */
const candidates = (rootPath: string, reference: string): string[] => {
  const direct = path.resolve(rootPath, reference);
  return [
    direct,
    path.join(direct, PIPELINE_FILE),
    ...FACTORY_DIRS.flatMap((dir: string): string[] => [
      path.join(rootPath, dir, reference, PIPELINE_FILE),
      // a wrapper skill folder (`.claude/skills/<id>`) names the factory with the same id
      path.join(rootPath, dir, path.basename(direct), PIPELINE_FILE),
    ]),
  ];
};

/**
 * A pipeline is named the way a person would name it: the file, the folder holding it, its
 * wrapper skill folder, or just the factory id (`factories.local/<id>/pipeline.json`, else
 * `factories/<id>/pipeline.json`). Returns the absolute path of the pipeline.json that reference means.
 */
export const locatePipelineFileFactory =
  (fileSystem: FileSystemAdapter) =>
  (rootPath: string) =>
  async (reference: string): Promise<string> => {
    const tried: string[] = candidates(rootPath, reference);
    for (const candidate of tried) {
      const isFile =
        (await fileSystem.exists(candidate)) && !(await fileSystem.isDirectory(candidate));
      if (isFile) return candidate;
    }
    throw createAppError('PIPELINE_NOT_FOUND', `no pipeline found for "${reference}"`, [
      ...tried.map((candidate: string): string => `looked at ${candidate}`),
    ]);
  };
