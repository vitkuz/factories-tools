import type {
  Answer,
  PendingEntry,
  PendingQuestion,
  Question,
  QuestionRecord,
  QuestionSource,
  QuestionStatus,
} from './questions.types.js';

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

type PendingQuestionArgs = Pick<
  PendingQuestion,
  'sessionId' | 'promptId' | 'toolUseId' | 'questions' | 'run'
>;

export const toPendingQuestion = (args: PendingQuestionArgs, askedAt: Date): PendingQuestion => {
  const { run, ...rest }: PendingQuestionArgs = args;
  return {
    ...rest,
    askedAt: askedAt.toISOString(),
    channel: 'hook',
    ...(run === undefined ? {} : { run }),
  };
};

/** `<promptId>.json`; the id is a uuid the API minted, so it is one safe file name. */
export const questionFileName = (promptId: string): string => `${promptId}.json`;

/** Only what the record keeps: neither the waiter nor the timers. */
const definedOnly = <T extends object>(value: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(value).filter(([, v]: [string, unknown]): boolean => v !== undefined),
  ) as Partial<T>;

/** The record on disk for an entry in a given state. Pure. */
export const toQuestionRecord = (
  entry: Pick<PendingEntry, 'question' | 'source'>,
  status: QuestionStatus,
  extra: Pick<QuestionRecord, 'answers' | 'resolvedAt' | 'delivered'> = {},
): QuestionRecord => ({
  ...entry.question,
  ...definedOnly<QuestionSource>(entry.source),
  status,
  ...definedOnly(extra),
});

/** The pending question a record describes, and where it came from; the live state is fresh. */
export const fromQuestionRecord = (
  record: QuestionRecord,
): Pick<PendingEntry, 'question' | 'source'> => {
  const {
    status: _status,
    claudeSessionId,
    transcriptPath,
    answers: _answers,
    resolvedAt: _resolvedAt,
    delivered: _delivered,
    ...question
  }: QuestionRecord = record;
  return {
    question,
    source: definedOnly<QuestionSource>({ claudeSessionId, transcriptPath }),
  };
};

/** Records the API must take up again after a restart: pending, or answered but not yet collected by the hook. */
export const isUnfinished = (record: QuestionRecord): boolean =>
  record.status === 'pending' ||
  ((record.status === 'answered' || record.status === 'dismissed') && record.delivered === false);
