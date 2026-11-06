import path from 'node:path';
import type { ZodSafeParseResult } from 'zod';
import type { DirEntryInfo, FsClient, JsonRead } from '../../../clients/fs/fs.types.js';
import type { AppLogger } from '../../../shared/types.js';
import { questionRecordSchema } from '../questions.schema.js';
import type { QuestionJournal, QuestionRecord } from '../questions.types.js';
import { questionFileName } from '../questions.utils.js';

export interface QuestionJournalSettings {
  fs: FsClient;
  /** `<PROMPT_DIR>/questions`: made 0700 on the first write, files 0600. */
  dir: string;
  logger?: AppLogger;
}

/**
 * One JSON file per question, named by its promptId, rewritten whole on every change. The
 * list is what the API rebuilds its pending questions from after a restart; every other
 * status stays as a record of what was asked and answered.
 */
export const createQuestionJournal = ({
  fs,
  dir,
  logger,
}: QuestionJournalSettings): QuestionJournal => {
  const readOne = async (name: string): Promise<QuestionRecord | null> => {
    const read: JsonRead = await fs.readJson(path.join(dir, name));
    if (!read.ok) {
      logger?.warn('question record unreadable', { file: name, message: read.message });
      return null;
    }
    const parsed: ZodSafeParseResult<QuestionRecord> = questionRecordSchema.safeParse(read.value);
    if (!parsed.success) {
      logger?.warn('question record of an unknown shape', { file: name });
      return null;
    }
    return parsed.data;
  };

  return {
    write: async (record: QuestionRecord): Promise<void> => {
      await fs.writePrivateText(
        dir,
        questionFileName(record.promptId),
        `${JSON.stringify(record, null, 2)}\n`,
      );
    },
    list: async (): Promise<QuestionRecord[]> => {
      const names: string[] = (await fs.listDir(dir))
        .filter((entry: DirEntryInfo): boolean => entry.isFile && entry.name.endsWith('.json'))
        .map((entry: DirEntryInfo): string => entry.name);
      const records: (QuestionRecord | null)[] = await Promise.all(names.map(readOne));
      return records.filter(
        (record: QuestionRecord | null): record is QuestionRecord => record !== null,
      );
    },
  };
};
