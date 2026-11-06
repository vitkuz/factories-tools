import { v4 as uuidv4 } from 'uuid';
import type { AppLogger } from '../../../shared/types.js';
import type { SessionRunLink } from '../../runs/runs.types.js';
import type { QuestionLifecycle } from '../services/question-lifecycle.service.js';
import type {
  AskUserQuestionPayload,
  HookOutcome,
  LocateQuestionRun,
  PendingEntry,
  PendingQuestion,
  QuestionStore,
} from '../questions.types.js';
import { toPendingQuestion } from '../questions.utils.js';

export interface RegisterQuestionSettings {
  store: QuestionStore;
  lifecycle: QuestionLifecycle;
  /** Finds the run the session is in, so the run page can show the question too. */
  locateRun?: LocateQuestionRun;
  logger?: AppLogger;
  newUuid?: () => string;
  now?: () => Date;
}

/**
 * The hook's request. A question the store already holds (the same session and tool use:
 * the hook asking again after a `wait`, after the API restarted, or after its connection
 * dropped) is taken up where it was, under the same promptId. A new one is opened: the run
 * it belongs to is looked up first and travels with it. Either way the request then waits
 * on the entry (see `QuestionLifecycle.attach`).
 */
export const registerQuestionFactory = ({
  store,
  lifecycle,
  locateRun,
  logger,
  newUuid = uuidv4,
  now = (): Date => new Date(),
}: RegisterQuestionSettings): ((
  payload: AskUserQuestionPayload,
  signal?: AbortSignal,
) => Promise<HookOutcome>) => {
  /** Opens the question (or takes a known one up again) and waits on it, in the same tick. */
  const start = (
    payload: AskUserQuestionPayload,
    run: SessionRunLink | null,
    signal?: AbortSignal,
  ): Promise<HookOutcome> => {
    const known: PendingEntry | undefined = store.findByToolUse(
      payload.sessionId,
      payload.toolUseId,
    );
    if (known) {
      logger?.info('question taken up again', {
        sessionId: payload.sessionId,
        promptId: known.question.promptId,
      });
      return lifecycle.attach(known, signal);
    }
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
    const entry: PendingEntry = lifecycle.open(question, {
      ...(payload.claudeSessionId === undefined
        ? {}
        : { claudeSessionId: payload.claudeSessionId }),
      ...(payload.transcriptPath === undefined ? {} : { transcriptPath: payload.transcriptPath }),
    });
    logger?.info('question registered', {
      sessionId: question.sessionId,
      promptId: question.promptId,
      count: question.questions.length,
      run: run === null ? null : `${run.pipelineId}/${run.runId} (${run.match})`,
    });
    return lifecycle.attach(entry, signal);
  };

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

  // Without `locateRun` the question is registered at once, in the same tick. A known question
  // (the hook asking again) skips the lookup: its run is already on the entry.
  return locateRun
    ? (payload: AskUserQuestionPayload, signal?: AbortSignal): Promise<HookOutcome> =>
        store.findByToolUse(payload.sessionId, payload.toolUseId)
          ? start(payload, null, signal)
          : locate(locateRun)(payload).then((run: SessionRunLink | null): Promise<HookOutcome> =>
              start(payload, run, signal),
            )
    : (payload: AskUserQuestionPayload, signal?: AbortSignal): Promise<HookOutcome> =>
        start(payload, null, signal);
};
