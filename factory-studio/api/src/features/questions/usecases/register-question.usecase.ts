import { v4 as uuidv4 } from 'uuid';
import type { AppLogger } from '../../../shared/types.js';
import type { SessionRunLink } from '../../runs/runs.types.js';
import type {
  AskUserQuestionPayload,
  Broadcast,
  HookOutcome,
  LocateQuestionRun,
  PendingQuestion,
  QuestionStore,
  ResolveReason,
} from '../questions.types.js';
import { toPendingQuestion } from '../questions.utils.js';

export interface RegisterQuestionSettings {
  store: QuestionStore;
  broadcast: Broadcast;
  /** Finds the run the session is in, so the run page can show the question too. */
  locateRun?: LocateQuestionRun;
  /** Gives up a little before the hook's own timeout (3600 s), so the terminal dialog opens. */
  timeoutMs?: number;
  logger?: AppLogger;
  newUuid?: () => string;
  now?: () => Date;
}

export const DEFAULT_QUESTION_TIMEOUT_MS = 3_540_000;

/**
 * Registers the question the hook is blocked on and shows it to every connected client. The
 * returned promise settles once: an answer or a dismissal from a client, the timeout, or the
 * hook going away (`signal`) — the last two release the pane to the terminal dialog. With
 * `locateRun`, the run the session is in is looked up first and travels with the question.
 */
export const registerQuestionFactory = ({
  store,
  broadcast,
  locateRun,
  timeoutMs = DEFAULT_QUESTION_TIMEOUT_MS,
  logger,
  newUuid = uuidv4,
  now = (): Date => new Date(),
}: RegisterQuestionSettings): ((
  payload: AskUserQuestionPayload,
  signal?: AbortSignal,
) => Promise<HookOutcome>) => {
  const wait = (
    payload: AskUserQuestionPayload,
    run: SessionRunLink | null,
    signal?: AbortSignal,
  ): Promise<HookOutcome> =>
    new Promise<HookOutcome>((resolve): void => {
      const question: PendingQuestion = toPendingQuestion(
        {
          sessionId: payload.sessionId,
          promptId: newUuid(),
          toolUseId: payload.toolUseId,
          questions: payload.toolInput.questions,
          ...(run === null ? {} : { run }),
        },
        now(),
      );
      const timer: NodeJS.Timeout = setTimeout(
        (): void => finish({ action: 'dismiss' }, 'timeout'),
        timeoutMs,
      );

      /** Whoever settles first wins; `store.remove` makes a second caller a no-op. */
      const finish = (outcome: HookOutcome, reason: ResolveReason): void => {
        if (!store.get(question.sessionId, question.promptId)) return;
        clearTimeout(timer);
        store.remove(question.promptId);
        resolve(outcome);
        broadcast({
          type: 'session.question.resolved',
          sessionId: question.sessionId,
          promptId: question.promptId,
          reason,
        });
        logger?.info('question settled', { sessionId: question.sessionId, reason });
      };

      store.add({
        question,
        settle: (outcome: HookOutcome, reason?: ResolveReason): void =>
          finish(outcome, reason ?? (outcome.action === 'answer' ? 'answered' : 'dismissed')),
      });
      signal?.addEventListener('abort', (): void => finish({ action: 'dismiss' }, 'terminal'), {
        once: true,
      });
      if (signal?.aborted) finish({ action: 'dismiss' }, 'terminal');
      else broadcast({ type: 'session.question', question });
      logger?.info('question registered', {
        sessionId: question.sessionId,
        promptId: question.promptId,
        count: question.questions.length,
        run: run === null ? null : `${run.pipelineId}/${run.runId} (${run.match})`,
      });
    });

  /** A run that cannot be told never holds the question back: it shows on Sessions only. */
  const locate =
    (find: LocateQuestionRun) =>
    (payload: AskUserQuestionPayload): Promise<SessionRunLink | null> =>
      find(payload).catch((error: unknown): null => {
        logger?.warn('could not tell the run of a question', {
          sessionId: payload.sessionId,
          message: error instanceof Error ? error.message : String(error),
        });
        return null;
      });

  // Without `locateRun` the question is registered at once, in the same tick.
  return locateRun
    ? (payload: AskUserQuestionPayload, signal?: AbortSignal): Promise<HookOutcome> =>
        locate(locateRun)(payload).then((run: SessionRunLink | null): Promise<HookOutcome> =>
          wait(payload, run, signal),
        )
    : (payload: AskUserQuestionPayload, signal?: AbortSignal): Promise<HookOutcome> =>
        wait(payload, null, signal);
};
