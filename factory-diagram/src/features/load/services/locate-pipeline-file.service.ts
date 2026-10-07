import type { FileSystemAdapter } from '../../../adapters/file-system/index.js';
import { createAppError } from '../../../shared/utils/error.utils.js';
import { FACTORY_DIRS, PIPELINE_FILE, locateCandidates } from '../load.utils.js';

/** The ids under `<root>/factories.local/` and `<root>/factories/` that hold a pipeline.json, sorted, once each. */
export const listPipelineIdsFactory =
  (fileSystem: FileSystemAdapter) =>
  (rootPath: string): string[] => {
    const ids: string[] = FACTORY_DIRS.flatMap((dir: string): string[] =>
      fileSystem
        .listDirectories(`${rootPath}/${dir}`)
        .filter((id: string): boolean =>
          fileSystem.exists(`${rootPath}/${dir}/${id}/${PIPELINE_FILE}`),
        ),
    );
    return [...new Set(ids)].sort();
  };

/**
 * A pipeline is named the way a person would name it: the file, the folder holding it, its
 * wrapper skill folder, or just the factory id. Returns the absolute pipeline.json it means.
 */
export const locatePipelineFileFactory =
  (fileSystem: FileSystemAdapter) =>
  (rootPath: string, cwd: string = process.cwd()) =>
  (reference: string): string => {
    const tried: string[] = locateCandidates(rootPath, reference, cwd);
    const found: string | undefined = tried.find(
      (candidate: string): boolean =>
        fileSystem.exists(candidate) && !fileSystem.isDirectory(candidate),
    );
    if (found !== undefined) return found;
    const ids: string[] = listPipelineIdsFactory(fileSystem)(rootPath);
    throw createAppError('PIPELINE_NOT_FOUND', `no pipeline found for "${reference}"`, [
      ...tried.map((candidate: string): string => `looked at ${candidate}`),
      `available ids: ${ids.join(', ') || '(none)'}`,
    ]);
  };
