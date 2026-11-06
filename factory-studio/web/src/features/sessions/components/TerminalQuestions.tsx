import type { ReactNode } from 'react';
import type { Question, QuestionOption } from '../sessions.types';

interface TerminalQuestionsProps {
  sessionId: string;
  questions: Question[];
}

/**
 * A question whose hook is gone: Claude's own dialog is open in the session's terminal and is
 * answered there. The questions and their options are shown as asked (read from disk, so a
 * reload or a restart keeps them), with where to answer; typed text would only pick the
 * highlighted option in the pane, so there is no form.
 */
export const TerminalQuestions = ({ sessionId, questions }: TerminalQuestionsProps): ReactNode => (
  <div className="ask-terminal">
    <p className="ask-terminal-text">
      Claude&rsquo;s own question dialog is open in this session&rsquo;s terminal and can only be
      answered there. Attach to the session, pick workspace {sessionId}, and answer with the arrow
      keys and Enter. Or stop the session.
    </p>
    <pre className="mono ask-terminal-command">herdr session attach factory-studio</pre>
    <ol className="ask-terminal-list">
      {questions.map((question: Question, index: number) => (
        <li key={`${index}-${question.question}`} className="ask-terminal-item">
          {question.header !== '' ? (
            <span className="ask-terminal-header">{question.header}</span>
          ) : null}
          <span className="ask-question">{question.question}</span>
          {question.options.length > 0 ? (
            <ul className="ask-terminal-options">
              {question.options.map((option: QuestionOption) => (
                <li key={option.label} className="ask-terminal-option">
                  <span className="ask-option-label">{option.label}</span>
                  {option.description !== '' && option.description !== option.label ? (
                    <span className="ask-option-desc">{option.description}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
  </div>
);
