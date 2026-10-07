import { describe, expect, it } from 'vitest';
import { locatePipelineFileFactory } from '../src/features/pipeline/services/index.js';
import { isAppError } from '../src/shared/utils/error.utils.js';
import { FACTORY, memoryFileSystem, ROOT } from './helpers.js';

const FILE = `${FACTORY}/pipeline.json`;
const locate = (reference: string): Promise<string> =>
  locatePipelineFileFactory(
    memoryFileSystem({
      [FILE]: '{}',
      [`${ROOT}/.claude/skills/demo-factory/SKILL.md`]: '# wrapper',
    }),
  )(ROOT)(reference);

describe('locate pipeline file', () => {
  it('resolves a factory id to factories/<id>/pipeline.json', async () => {
    expect(await locate('demo-factory')).toBe(FILE);
  });

  it('accepts a direct path to the pipeline.json', async () => {
    expect(await locate('factories/demo-factory/pipeline.json')).toBe(FILE);
    expect(await locate(FILE)).toBe(FILE);
  });

  it('accepts the folder holding the pipeline.json', async () => {
    expect(await locate('factories/demo-factory')).toBe(FILE);
  });

  it('a local factory (factories.local/<id>) wins over the shared one', async () => {
    const local = `${ROOT}/factories.local/demo-factory/pipeline.json`;
    const found: string = await locatePipelineFileFactory(
      memoryFileSystem({ [FILE]: '{}', [local]: '{}' }),
    )(ROOT)('demo-factory');
    expect(found).toBe(local);
  });

  it('maps a wrapper skill folder to the factory of the same id', async () => {
    expect(await locate('.claude/skills/demo-factory')).toBe(FILE);
  });

  it('names every place it looked when nothing is found', async () => {
    const error: unknown = await locate('missing-factory').catch((caught: unknown) => caught);
    expect(isAppError(error)).toBe(true);
  });
});
