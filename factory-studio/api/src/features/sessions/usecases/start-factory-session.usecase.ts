import { v4 as uuidv4 } from 'uuid';
import type { AppLogger } from '../../../shared/types.js';
import type { FactoryParam, ReadFactoryParams } from '../../pipelines/pipelines.types.js';
import type {
  ResolveParamsResult,
  StartFactoryResult,
  StartSessionArgs,
  SessionMeta,
  StartSessionPayload,
  StartedRun,
} from '../sessions.types.js';
import {
  buildFactoryParamsPrompt,
  buildFactoryPrompt,
  buildSessionEnv,
  buildSessionMeta,
  buildSessionName,
  resolveStartParams,
} from '../sessions.utils.js';
import { buildHarnessCommand } from '../services/build-harness-command.service.js';

export interface StartFactorySessionSettings {
  workDir: string;
  /** Ids that may start: the pipeline skills on disk, read on every call. */
  listFactorySkills: () => Promise<string[]>;
  /** The params the factory's `pipeline.json` declares, read on every call. */
  readFactoryParams: ReadFactoryParams;
  writePromptFile: (session: string, text: string) => Promise<string>;
  /** Writes the per-session claude settings (the question hook) and returns the file path. */
  writeHookSettings: (session: string) => Promise<string>;
  /** Persists what `GET /sessions` needs after an API restart. */
  writeSessionMeta: (meta: SessionMeta) => Promise<string>;
  /** `STUDIO_API_URL` and `STUDIO_API_KEY`, the same for every session. */
  hookEnv: Readonly<Record<string, string>>;
  startSession: (args: StartSessionArgs) => Promise<boolean>;
  logger?: AppLogger;
  newUuid?: () => string;
  now?: () => Date;
}

type PromptResult = { ok: true; prompt: string } | Extract<StartFactoryResult, { ok: false }>;

/**
 * The prompt a start sends. With params: checked against the declared ones and written as
 * `/<id> name=value ...`, extra instructions after them. Without: the free-text `/<id> <prompt>`
 * of a factory that declares none (or of an older caller).
 */
const buildPrompt = (
  { id, params, prompt }: StartSessionPayload,
  declared: readonly FactoryParam[],
): PromptResult => {
  if (Object.keys(params).length === 0) {
    return prompt === ''
      ? {
          ok: false,
          reason: 'invalid-params',
          issues: [{ path: ['prompt'], message: 'prompt must not be empty' }],
        }
      : { ok: true, prompt: buildFactoryPrompt(id, prompt) };
  }
  const resolved: ResolveParamsResult = resolveStartParams(declared, params);
  return resolved.ok
    ? { ok: true, prompt: buildFactoryParamsPrompt(id, resolved.params, prompt) }
    : { ok: false, reason: 'invalid-params', issues: resolved.issues };
};

/**
 * The story of a start: check the skill exists, check its params, mint a session name, write the prompt down,
 * write the hook settings and meta, build the harness command, start the session, say what started.
 *
 * Never refuses because the same factory is already running: that is the caller's call.
 */
export const startFactorySessionFactory =
  ({
    workDir,
    listFactorySkills,
    readFactoryParams,
    writePromptFile,
    writeHookSettings,
    writeSessionMeta,
    hookEnv,
    startSession,
    logger,
    newUuid = uuidv4,
    now = (): Date => new Date(),
  }: StartFactorySessionSettings) =>
  async (payload: StartSessionPayload): Promise<StartFactoryResult> => {
    const { id, harness }: StartSessionPayload = payload;
    const available: string[] = await listFactorySkills();
    if (!available.includes(id)) {
      logger?.warn('start refused: no such factory skill', { id });
      return { ok: false, reason: 'unknown-factory', available };
    }

    const declared: FactoryParam[] = (await readFactoryParams(id)) ?? [];
    const built: PromptResult = buildPrompt(payload, declared);
    if (!built.ok) {
      logger?.warn('start refused: params do not fit the factory', { id });
      return built;
    }

    const session: string = buildSessionName(id, newUuid());
    const fullPrompt: string = built.prompt;
    const promptFile: string = await writePromptFile(session, fullPrompt);

    const settingsFile: string | undefined =
      harness === 'claude' ? await writeHookSettings(session) : undefined;
    await writeSessionMeta(buildSessionMeta({ session, factoryId: id, harness }, now()));

    const command: string = buildHarnessCommand(harness, promptFile, { settingsFile });
    const alive: boolean = await startSession({
      session,
      factoryId: id,
      harness,
      command,
      workDir,
      env: buildSessionEnv(hookEnv, session),
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
