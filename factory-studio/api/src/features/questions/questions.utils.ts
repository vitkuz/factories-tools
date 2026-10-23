import type { Answer, PendingQuestion, Question } from './questions.types.js';

/** `"A, B"` for a multi-select, the label for a single one, the text alone, or both joined. */
export const answerToValue = (answer: Answer): string => {
  const text: string = (answer.text ?? '').trim();
  return [...answer.selected, ...(text === '' ? [] : [text])].join(', ');
};

/** The map the hook hands back to Claude: key = exact question text. */
export const buildAnswersMap = (answers: readonly Answer[]): Record<string, string> =>
  Object.fromEntries(
    answers.map((answer: Answer): [string, string] => [answer.question, answerToValue(answer)]),
  );

const optionLabels = (question: Question): string[] =>
  question.options.map((option: { label: string }): string => option.label);

/** `null` when the answers fit the questions, otherwise what is wrong with them. */
export const validateAnswers = (
  questions: readonly Question[],
  answers: readonly Answer[],
): string | null => {
  const unanswered: Question | undefined = questions.find(
    (question: Question): boolean =>
      !answers.some((answer: Answer): boolean => answer.question === question.question),
  );
  if (unanswered) return `question not answered: "${unanswered.question}"`;

  const unknown: Answer | undefined = answers.find(
    (answer: Answer): boolean =>
      !questions.some((question: Question): boolean => question.question === answer.question),
  );
  if (unknown) return `answer to an unknown question: "${unknown.question}"`;

  for (const answer of answers) {
    const question: Question | undefined = questions.find(
      (candidate: Question): boolean => candidate.question === answer.question,
    );
    const labels: string[] = question ? optionLabels(question) : [];
    const stray: string | undefined = answer.selected.find(
      (label: string): boolean => !labels.includes(label),
    );
    if (stray !== undefined) return `"${stray}" is not an option of "${answer.question}"`;
    if (question && !question.multiSelect && answer.selected.length > 1) {
      return `"${answer.question}" takes one option`;
    }
  }
  return null;
};

export const toPendingQuestion = (
  args: Pick<PendingQuestion, 'sessionId' | 'promptId' | 'toolUseId' | 'questions' | 'run'>,
  askedAt: Date,
): PendingQuestion => {
  const {
    run,
    ...rest
  }: Pick<PendingQuestion, 'sessionId' | 'promptId' | 'toolUseId' | 'questions' | 'run'> = args;
  return { ...rest, askedAt: askedAt.toISOString(), ...(run === undefined ? {} : { run }) };
};
