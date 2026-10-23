import { useState, type ReactNode } from 'react';
import type { Answer, Draft, PendingQuestion, SendState } from '../sessions.types';
import {
  answeredCount,
  buildAnswers,
  draftsFor,
  isComplete,
  questionPreview,
  replaceDraft,
} from '../sessions.utils';
import { Notice } from '../../../shared/components/Notice';
import { QuestionBody } from './QuestionBody';
import { QuestionStepper, panelId, tabId } from './QuestionStepper';
import { CardHead } from './CardHead';
import { StopButton } from './StopButton';

interface QuestionCardProps {
  question: PendingQuestion;
  send: SendState;
  /** The session's factory, once the list knows the session. */
  factoryId: string | null;
  /** How long the question has waited. */
  wait: string;
  /** The socket is open: answers can leave. */
  connected: boolean;
  /** Only one card is open at a time; a closed one keeps its drafts. */
  open: boolean;
  /** With `onStop`: its stop is in flight. */
  stopping?: boolean;
  onOpen: () => void;
  onLater: () => void;
  onAnswer: (question: PendingQuestion, answers: Answer[]) => void;
  /** Left out where the session is not to be stopped from (the run page): no Stop button. */
  onStop?: () => void;
}

/** One question Claude is asking, as a "Needs you" card: a line and Answer, or the stepper, the active question and Submit. */
export const QuestionCard = ({
  question,
  send,
  factoryId,
  wait,
  connected,
  open,
  stopping = false,
  onOpen,
  onLater,
  onAnswer,
  onStop,
}: QuestionCardProps): ReactNode => {
  const [drafts, setDrafts] = useState<Draft[]>(() => draftsFor(question.questions));
  const [active, setActive] = useState<number>(0);
  const idPrefix = `ask-${question.promptId}`;
  const total: number = question.questions.length;
  const answered: number = answeredCount(drafts);
  const complete: boolean = isComplete(question.questions, drafts);
  const locked: boolean = send.phase === 'sending' || send.phase === 'sent';
  const current = question.questions[active];
  const draft: Draft = drafts[active] ?? { selected: [], text: '' };

  const submit = (): void => {
    if (!complete || locked || !connected) return;
    onAnswer(question, buildAnswers(question.questions, drafts));
  };

  const submitLabel: string =
    send.phase === 'sending'
      ? 'Sending…'
      : send.phase === 'sent'
        ? 'Sent'
        : complete
          ? 'Submit'
          : `${answered} / ${total} answered`;

  return (
    <article
      className={`board-card ask-card${open ? ' is-open' : ''}`}
      aria-label={`Question from ${question.sessionId}`}
    >
      <CardHead session={question.sessionId} factoryId={factoryId}>
        {wait !== '' ? (
          <time className="board-card-aside" dateTime={question.askedAt} title={question.askedAt}>
            {wait}
          </time>
        ) : null}
      </CardHead>
      {!open ? (
        <div className="board-card-row">
          <span className="board-card-preview">{questionPreview(question.questions, drafts)}</span>
          <button type="button" className="answer-button" onClick={onOpen}>
            Answer
          </button>
        </div>
      ) : (
        <>
          {total > 1 ? (
            <QuestionStepper
              idPrefix={idPrefix}
              questions={question.questions}
              drafts={drafts}
              active={active}
              disabled={locked}
              onSelect={setActive}
            />
          ) : null}
          {current ? (
            <div
              id={panelId(idPrefix)}
              role={total > 1 ? 'tabpanel' : undefined}
              aria-labelledby={total > 1 ? tabId(idPrefix, active) : undefined}
            >
              <QuestionBody
                key={active}
                idPrefix={`${idPrefix}-q${active}`}
                question={current}
                draft={draft}
                disabled={locked}
                onChange={(next: Draft): void => setDrafts(replaceDraft(drafts, active, next))}
              />
            </div>
          ) : null}
          {send.phase === 'error' && send.error ? (
            <Notice tone="refusal">{send.error}</Notice>
          ) : null}
          {send.phase === 'sent' ? (
            <Notice tone="ok">Answer sent. Waiting for Claude to pick it up…</Notice>
          ) : null}
          <footer className="ask-foot">
            <span className="visually-hidden" aria-live="polite">
              {answered} of {total} answered
            </span>
            <div className="ask-aside-actions">
              <button type="button" className="ghost-button" onClick={onLater}>
                Later
              </button>
              {onStop ? <StopButton stopping={stopping} onStop={onStop} /> : null}
            </div>
            <div className="ask-actions">
              {active < total - 1 ? (
                <button
                  type="button"
                  className="ghost-button"
                  disabled={locked}
                  onClick={(): void => setActive(active + 1)}
                >
                  Next
                </button>
              ) : null}
              <button
                type="button"
                className="primary-button"
                disabled={!complete || locked || !connected}
                onClick={submit}
              >
                {submitLabel}
              </button>
            </div>
          </footer>
        </>
      )}
    </article>
  );
};
