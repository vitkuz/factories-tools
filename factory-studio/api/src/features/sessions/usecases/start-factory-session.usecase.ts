import { v4 as uuidv4 } from 'uuid';
import type { AppLogger } from '../../../shared/types.js';
import type {
  StartFactoryResult,
  StartSessionArgs,
  StartSessionPayload,
  StartedRun,
} from '../sessions.types.js';
import { buildFactoryPrompt, buildSessionName } from '../sessions.utils.js';
import { buildHarnessCommand } from '../services/build-harness-command.service.js';

export interface StartFactorySessionSettings {
  workDir: string;
  /** Ids that may start: the pipeline skills on disk, read on every call. */
  listFactorySkills: () => Promise<string[]>;
  writePromptFile: (session: string, text: string) => Promise<string>;
  startSession: (args: StartSessionArgs) => Promise<boolean>;
  logger?: AppLogger;
  newUuid?: () => string;
}

/**
 * The story of a start: check the skill exists, mint a session name, write the prompt down,
 * build the harness command, start the session, say what started.
 *
 * Never refuses because the same factory is already running: that is the caller's call.
 */
export const startFactorySessionFactory =
  ({
    workDir,
    listFactorySkills,
    writePromptFile,
    startSession,
    logger,
    newUuid = uuidv4,
  }: StartFactorySessionSettings) =>
  async ({ id, prompt, harness }: StartSessionPayload): Promise<StartFactoryResult> => {
    const available: string[] = await listFactorySkills();
    if (!available.includes(id)) {
      logger?.warn('start refused: no such factory skill', { id });
      return { ok: false, reason: 'unknown-factory', available };
    }

    const session: string = buildSessionName(id, newUuid());
    const fullPrompt: string = buildFactoryPrompt(id, prompt);
    const promptFile: string = await writePromptFile(session, fullPrompt);

    const command: string = buildHarnessCommand(harness, promptFile);
    const alive: boolean = await startSession({
      session,
      factoryId: id,
      harness,
      command,
      workDir,
    });
    if (!alive) return { ok: false, reason: 'exited-immediately', session, harness };

    const run: StartedRun = {
      session,
      factoryId: id,
      harness,
      prompt: fullPrompt,
      promptFile,
      workDir,
    };
    logger?.info('factory started', { session, factoryId: id, harness });
    return { ok: true, run };
  };
