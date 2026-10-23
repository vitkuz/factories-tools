import { useState, type ReactNode } from 'react';
import { useNow } from '../../../shared/lib/polling';
import { Notice } from '../../../shared/components/Notice';
import { useQuestions } from '../hooks/use-questions';
import type { SessionQuestions } from '../hooks/use-session-questions';
import type { PendingQuestion, SessionRunLink } from '../sessions.types';
import { idleSend, openPromptId, questionsForRun, waitedFor } from '../sessions.utils';
import { QuestionCard } from './QuestionCard';

interface RunQuestionPanelProps {
  run: Pick<SessionRunLink, 'pipelineId' | 'runId'>;
}

/**
 * The questions Claude asks in this run, as the Sessions board shows them: the same card, the
 * same socket. Nothing is drawn while the run asks nothing; a card goes away on
 * `session.question.resolved`, wherever the answer came from.
 */
export const RunQuestionPanel = ({ run }: RunQuestionPanelProps): ReactNode => {
  const questions: SessionQuestions = useQuestions();
  // undefined: nothing picked yet (the oldest is open); null: "Later" closed them all.
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const asked: PendingQuestion[] = questionsForRun(questions.state.pending, run);
  const now: number = useNow(asked.length > 0 ? 1000 : null);
  if (asked.length === 0) return null;
  const open: string | null = openPromptId(asked, chosen);
  const connected: boolean = questions.connection === 'open';

  return (
    <section className="pane run-ask" aria-label="Claude is asking">
      <h3 className="run-ask-title">Needs you</h3>
      {!connected ? (
        <Notice tone="plain">
          Live connection is down. Reconnecting; you cannot answer meanwhile.
        </Notice>
      ) : null}
      {questions.state.lastError !== null ? (
        <div className="ask-error">
          <Notice tone="refusal">{questions.state.lastError}</Notice>
          <button type="button" className="ghost-button" onClick={questions.clearError}>
            Dismiss
          </button>
        </div>
      ) : null}
      {asked.map((question: PendingQuestion) => (
        <QuestionCard
          key={question.promptId}
          question={question}
          send={questions.state.prompts[question.promptId] ?? idleSend}
          factoryId={run.pipelineId}
          wait={waitedFor(question.askedAt, now)}
          connected={connected}
          open={open === question.promptId}
          onOpen={(): void => setChosen(question.promptId)}
          onLater={(): void => setChosen(null)}
          onAnswer={questions.answer}
        />
      ))}
    </section>
  );
};
