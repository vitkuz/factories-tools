import type { FileSystemAdapter } from '../../../adapters/file-system/index.js';
import { isGlob } from '../../pipeline/index.js';
import type { ResolvedStep } from '../../pipeline/index.js';
import type { InputListing, KnowledgeText, StepMaterials } from '../run.types.js';

/** A path or a pattern, turned into the files that are really there right now. */
export const expandFilesFactory =
  (fileSystem: FileSystemAdapter) =>
  async (declared: string): Promise<string[]> => {
    if (isGlob(declared)) return fileSystem.glob(declared);
    return (await fileSystem.exists(declared)) ? [declared] : [];
  };

/**
 * Everything a step's prompt is made of that lives on disk: the full text of each knowledge file
 * (pasted, never passed as a path and hoped for) and what each declared input looks like now.
 */
export const collectStepMaterialsFactory =
  (fileSystem: FileSystemAdapter) =>
  async (step: ResolvedStep): Promise<StepMaterials> => {
    const expand = expandFilesFactory(fileSystem);
    const found: string[][] = await Promise.all(step.knowledge.map(expand));
    const knowledgeFiles: string[] = found.flat();
    const missingKnowledge: string[] = step.knowledge.filter(
      (_declared: string, index: number): boolean => (found[index] ?? []).length === 0,
    );
    const knowledge: KnowledgeText[] = await Promise.all(
      knowledgeFiles.map(async (file: string): Promise<KnowledgeText> => ({
        file,
        text: await fileSystem.readText(file),
      })),
    );
    const inputs: InputListing[] = await Promise.all(
      step.input.map(async (declared: string): Promise<InputListing> => ({
        declared,
        files: await expand(declared),
      })),
    );
    return { knowledge, missingKnowledge, inputs };
  };
