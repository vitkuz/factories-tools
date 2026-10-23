import type { ChangeEvent, ReactNode } from 'react';
import type { Draft, Question, QuestionOption } from '../sessions.types';
import { setDraftText, toggleOption } from '../sessions.utils';

interface QuestionBodyProps {
  /** Unique per question: names the radio group and ties the labels to the inputs. */
  idPrefix: string;
  question: Question;
  draft: Draft;
  disabled: boolean;
  onChange: (draft: Draft) => void;
}

/** The question text, its options (radio or checkbox, with descriptions) and a free text field. */
export const QuestionBody = ({
  idPrefix,
  question,
  draft,
  disabled,
  onChange,
}: QuestionBodyProps): ReactNode => {
  const type: 'checkbox' | 'radio' = question.multiSelect ? 'checkbox' : 'radio';
  const textId: string = `${idPrefix}-text`;
  return (
    <fieldset className="ask-body" disabled={disabled}>
      <legend className="ask-question">{question.question}</legend>
      <p className="ask-hint">{question.multiSelect ? 'Select all that apply.' : 'Select one.'}</p>
      <div className="ask-options">
        {question.options.map((option: QuestionOption) => (
          <label key={option.label} className="ask-option">
            <input
              type={type}
              name={idPrefix}
              checked={draft.selected.includes(option.label)}
              onChange={(): void => onChange(toggleOption(question, draft, option.label))}
            />
            <span className="ask-option-text">
              <span className="ask-option-label">{option.label}</span>
              {option.description !== '' ? (
                <span className="ask-option-desc">{option.description}</span>
              ) : null}
            </span>
          </label>
        ))}
      </div>
      <div className="ask-other">
        <label className="ask-other-label" htmlFor={textId}>
          Type something
        </label>
        <input
          id={textId}
          type="text"
          className="ask-input"
          value={draft.text}
          placeholder={question.multiSelect ? 'Add your own answer…' : 'Or write your own answer…'}
          autoComplete="off"
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            onChange(setDraftText(question, draft, event.target.value))
          }
        />
      </div>
    </fieldset>
  );
};
