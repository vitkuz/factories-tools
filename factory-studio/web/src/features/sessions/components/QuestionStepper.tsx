import type { KeyboardEvent, ReactNode } from 'react';
import type { Draft, Question } from '../sessions.types';
import { isAnswered, nextTabIndex } from '../sessions.utils';

interface QuestionStepperProps {
  /** Prefix of the ids the tabs and their panel share. */
  idPrefix: string;
  questions: Question[];
  drafts: Draft[];
  active: number;
  disabled: boolean;
  onSelect: (index: number) => void;
}

export const tabId = (idPrefix: string, index: number): string => `${idPrefix}-tab-${index}`;
export const panelId = (idPrefix: string): string => `${idPrefix}-panel`;

/** One tab per question, headed by its short `header`, marked once answered. Arrow keys move. */
export const QuestionStepper = ({
  idPrefix,
  questions,
  drafts,
  active,
  disabled,
  onSelect,
}: QuestionStepperProps): ReactNode => {
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const next: number | null = nextTabIndex(event.key, active, questions.length);
    if (next === null) return;
    event.preventDefault();
    onSelect(next);
    document.getElementById(tabId(idPrefix, next))?.focus();
  };

  return (
    <div className="ask-tabs" role="tablist" aria-label="Questions">
      {questions.map((question: Question, index: number) => {
        const answered: boolean = isAnswered(drafts[index] ?? { selected: [], text: '' });
        return (
          <button
            key={question.question}
            id={tabId(idPrefix, index)}
            type="button"
            role="tab"
            className={`ask-tab${answered ? ' is-answered' : ''}`}
            aria-selected={index === active}
            aria-controls={panelId(idPrefix)}
            tabIndex={index === active ? 0 : -1}
            disabled={disabled}
            onClick={(): void => onSelect(index)}
            onKeyDown={onKeyDown}
          >
            <span className="ask-tab-mark" aria-hidden="true">
              {answered ? '✓' : index + 1}
            </span>
            <span className="ask-tab-label">{question.header}</span>
            <span className="visually-hidden">{answered ? ' (answered)' : ' (not answered)'}</span>
          </button>
        );
      })}
    </div>
  );
};
