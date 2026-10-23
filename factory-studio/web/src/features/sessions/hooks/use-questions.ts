import { createContext, useContext } from 'react';
import type { SessionQuestions } from './use-session-questions';

/** The app's one question socket, opened by `QuestionsProvider` and read by every screen. */
export const QuestionsContext = createContext<SessionQuestions | null>(null);

/** The questions and the means to answer them; only inside `QuestionsProvider`. */
export const useQuestions = (): SessionQuestions => {
  const questions: SessionQuestions | null = useContext(QuestionsContext);
  if (questions === null) throw new Error('useQuestions is used outside QuestionsProvider');
  return questions;
};
