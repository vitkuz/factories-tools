import type { ReactNode } from 'react';
import questionChime from '../../../assets/question-chime.wav';
import { useChime } from '../../../shared/lib/use-chime';
import { QuestionsContext } from '../hooks/use-questions';
import { useSessionQuestions, type SessionQuestions } from '../hooks/use-session-questions';

interface QuestionsProviderProps {
  children: ReactNode;
}

/**
 * Opens the question socket once for the whole app, so the Sessions board and the run page
 * share one connection and one list, and chimes for each new question whatever screen is on.
 */
export const QuestionsProvider = ({ children }: QuestionsProviderProps): ReactNode => {
  const questions: SessionQuestions = useSessionQuestions();
  useChime(questionChime, questions.state.pending.length);
  return <QuestionsContext.Provider value={questions}>{children}</QuestionsContext.Provider>;
};
