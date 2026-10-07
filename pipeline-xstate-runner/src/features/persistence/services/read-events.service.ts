import type { FileSystemClient } from '../../../clients/file-system/types.js';
import type { Result } from '../../../shared/types/result.types.js';
import { ok, refuse } from '../../../shared/utils/result.utils.js';
import { eventLineSchema } from '../persistence.schema.js';
import type { EventLine } from '../persistence.types.js';
import { eventsPathFor } from './write-run-files.service.js';

export const EVENTS_CHECKS = {
  exists: { id: 'events-exist', description: 'The run folder holds an events.jsonl.' },
  valid: { id: 'events-valid', description: 'Every line of events.jsonl is a numbered event.' },
} as const;

/** The events the run machine received, in order, as events.jsonl recorded them. */
export const readEventsFactory =
  (fileSystem: FileSystemClient) =>
  (runDir: string): Result<EventLine[]> => {
    const file: string = eventsPathFor(runDir);
    if (!fileSystem.exists(file)) {
      return refuse(EVENTS_CHECKS.exists.id)(`no events.jsonl in ${runDir}`);
    }
    const lines: string[] = fileSystem
      .readText(file)
      .split('\n')
      .filter((line: string): boolean => line.trim() !== '');
    const parsed = lines.map((line: string, index: number) => {
      try {
        return eventLineSchema.safeParse(JSON.parse(line) as unknown);
      } catch {
        return { success: false as const, error: new Error(`line ${index + 1} is not JSON`) };
      }
    });
    const bad = parsed.findIndex((entry) => !entry.success);
    if (bad >= 0) return refuse(EVENTS_CHECKS.valid.id)(`${file}: line ${bad + 1} is not an event`);
    return ok(parsed.flatMap((entry): EventLine[] => (entry.success ? [entry.data] : [])));
  };
