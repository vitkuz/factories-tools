import { describe, expect, it } from 'vitest';
import {
  answerSchema,
  clientMessageSchema,
  serverMessageSchema,
} from '../src/features/sessions/sessions.schema';
import type {
  Draft,
  FactorySession,
  PendingQuestion,
  Question,
  QuestionsState,
} from '../src/features/sessions/sessions.types';
import {
  boardColumnOf,
  buildAnswers,
  compactAge,
  draftsFor,
  groupSessions,
  needsYouCount,
  openPromptId,
  questionPreview,
  shortSessionName,
  waitedFor,
  effectiveStatus,
  initialQuestionsState,
  isComplete,
  nextTabIndex,
  reduceQuestions,
  replaceDraft,
  questionsForRun,
  sessionsNeedingReply,
  setDraftText,
  titleWithCount,
  toggleOption,
} from '../src/features/sessions/sessions.utils';
import { reconnectDelay, socketUrlFor } from '../src/shared/lib/websocket.utils';

const single: Question = {
  header: 'Scope',
  question: 'Which scope?',
  multiSelect: false,
  options: [
    { label: 'Small', description: 'a little' },
    { label: 'Large', description: 'a lot' },
  ],
};
const multi: Question = {
  header: 'Extras',
  question: 'Which extras?',
  multiSelect: true,
  options: [
    { label: 'A', description: '' },
    { label: 'B', description: '' },
    { label: 'C', description: '' },
  ],
};
const pending = (promptId: string, sessionId = 's1'): PendingQuestion => ({
  sessionId,
  promptId,
  toolUseId: `tu-${promptId}`,
  questions: [single, multi],
  askedAt: '2026-10-20T10:00:00.000Z',
});
const session = (name: string, status?: FactorySession['status']): FactorySession => ({
  session: name,
  factoryId: 'x-factory',
  harness: 'claude',
  startedAt: '2026-10-20T10:00:00.000Z',
  ageSeconds: 1,
  age: '1s',
  ...(status ? { status } : {}),
});

describe('protocol schemas', () => {
  it('parses every server message', () => {
    const frames: unknown[] = [
      { type: 'hello', pending: [pending('p1')] },
      { type: 'session.question', question: pending('p1') },
      { type: 'session.question.resolved', sessionId: 's1', promptId: 'p1', reason: 'answered' },
      { type: 'session.status', sessionId: 's1', status: 'blocked' },
      { type: 'error', message: 'nope', ref: 'p1' },
      { type: 'error', message: 'nope' },
    ];
    for (const frame of frames) expect(serverMessageSchema.safeParse(frame).success).toBe(true);
  });

  it('rejects unknown types, statuses and reasons', () => {
    expect(serverMessageSchema.safeParse({ type: 'bogus' }).success).toBe(false);
    expect(
      serverMessageSchema.safeParse({ type: 'session.status', sessionId: 's', status: 'asleep' })
        .success,
    ).toBe(false);
    expect(
      serverMessageSchema.safeParse({
        type: 'session.question.resolved',
        sessionId: 's',
        promptId: 'p',
        reason: 'bored',
      }).success,
    ).toBe(false);
  });

  it('checks client messages', () => {
    expect(
      clientMessageSchema.safeParse({
        type: 'session.answer',
        sessionId: 's',
        promptId: 'p',
        answers: [{ question: 'q', selected: ['a'] }],
      }).success,
    ).toBe(true);
    expect(
      clientMessageSchema.safeParse({ type: 'session.reply', sessionId: 's', text: '' }).success,
    ).toBe(false);
    expect(answerSchema.safeParse({ question: 'q', selected: [], text: 'hi' }).success).toBe(true);
  });
});

describe('answering', () => {
  it('is complete only when every question is answered', () => {
    const questions: Question[] = [single, multi];
    const drafts: Draft[] = draftsFor(questions);
    expect(isComplete(questions, drafts)).toBe(false);
    const one: Draft[] = replaceDraft(drafts, 0, toggleOption(single, drafts[0]!, 'Small'));
    expect(isComplete(questions, one)).toBe(false);
    const both: Draft[] = replaceDraft(one, 1, setDraftText(multi, one[1]!, 'my own'));
    expect(isComplete(questions, both)).toBe(true);
    expect(isComplete([], [])).toBe(false);
  });

  it('treats whitespace-only text as unanswered', () => {
    const drafts: Draft[] = [setDraftText(single, { selected: [], text: '' }, '   ')];
    expect(isComplete([single], drafts)).toBe(false);
  });

  it('single select: a pick replaces text, typing replaces the pick', () => {
    const picked: Draft = toggleOption(single, { selected: [], text: 'typed' }, 'Large');
    expect(picked).toEqual({ selected: ['Large'], text: '' });
    expect(setDraftText(single, picked, 'other')).toEqual({ selected: [], text: 'other' });
    expect(toggleOption(single, picked, 'Small')).toEqual({ selected: ['Small'], text: '' });
  });

  it('multi select: toggles labels and keeps text', () => {
    const a: Draft = toggleOption(multi, { selected: [], text: 'x' }, 'A');
    const ab: Draft = toggleOption(multi, a, 'B');
    expect(ab).toEqual({ selected: ['A', 'B'], text: 'x' });
    expect(toggleOption(multi, ab, 'A')).toEqual({ selected: ['B'], text: 'x' });
  });

  it('builds the answers payload in question order, labels in option order, text trimmed', () => {
    const answers = buildAnswers(
      [single, multi],
      [
        { selected: ['Large'], text: '' },
        { selected: ['C', 'A'], text: '  and more ' },
      ],
    );
    expect(answers).toEqual([
      { question: 'Which scope?', selected: ['Large'] },
      { question: 'Which extras?', selected: ['A', 'C'], text: 'and more' },
    ]);
    expect(answers.every((a) => answerSchema.safeParse(a).success)).toBe(true);
  });

  it('does not mutate its inputs', () => {
    const draft: Draft = { selected: ['A'], text: '' };
    toggleOption(multi, draft, 'B');
    expect(draft).toEqual({ selected: ['A'], text: '' });
  });
});

describe('tab keys', () => {
  it('moves and wraps', () => {
    expect(nextTabIndex('ArrowRight', 2, 3)).toBe(0);
    expect(nextTabIndex('ArrowLeft', 0, 3)).toBe(2);
    expect(nextTabIndex('Home', 2, 3)).toBe(0);
    expect(nextTabIndex('End', 0, 3)).toBe(2);
    expect(nextTabIndex('a', 0, 3)).toBeNull();
    expect(nextTabIndex('ArrowRight', 0, 0)).toBeNull();
  });
});

describe('questions state', () => {
  const hello = (ids: string[]): QuestionsState =>
    reduceQuestions(initialQuestionsState, {
      kind: 'message',
      message: { type: 'hello', pending: ids.map((id: string) => pending(id)) },
    });

  it('hello replaces pending and drops stale prompt states', () => {
    const sending = reduceQuestions(hello(['p1', 'p2']), { kind: 'sending', promptId: 'p1' });
    const again = reduceQuestions(sending, {
      kind: 'message',
      message: { type: 'hello', pending: [pending('p2')] },
    });
    expect(again.pending.map((p) => p.promptId)).toEqual(['p2']);
    expect(again.prompts.p1).toBeUndefined();
  });

  it('adds a question once and removes it when resolved', () => {
    const added = reduceQuestions(hello([]), {
      kind: 'message',
      message: { type: 'session.question', question: pending('p1') },
    });
    const twice = reduceQuestions(added, {
      kind: 'message',
      message: { type: 'session.question', question: pending('p1') },
    });
    expect(twice.pending).toHaveLength(1);
    const resolved = reduceQuestions(reduceQuestions(twice, { kind: 'sending', promptId: 'p1' }), {
      kind: 'message',
      message: {
        type: 'session.question.resolved',
        sessionId: 's1',
        promptId: 'p1',
        reason: 'terminal',
      },
    });
    expect(resolved.pending).toEqual([]);
    expect(resolved.prompts).toEqual({});
  });

  it('routes an error with a prompt ref to that prompt, others to lastError', () => {
    const sending = reduceQuestions(hello(['p1']), { kind: 'sending', promptId: 'p1' });
    const failed = reduceQuestions(sending, {
      kind: 'message',
      message: { type: 'error', message: 'bad answer', ref: 'p1' },
    });
    expect(failed.prompts.p1).toEqual({ phase: 'error', error: 'bad answer' });
    const general = reduceQuestions(failed, {
      kind: 'message',
      message: { type: 'error', message: 'boom' },
    });
    expect(general.lastError).toBe('boom');
  });

  it('turns an in-flight answer into an error when the socket drops', () => {
    const sending = reduceQuestions(hello(['p1', 'p2']), { kind: 'sending', promptId: 'p1' });
    const dropped = reduceQuestions(sending, { kind: 'disconnected' });
    expect(dropped.prompts.p1?.phase).toBe('error');
    expect(dropped.pending).toHaveLength(2);
  });

  it('finds blocked sessions that have no pending question', () => {
    const state: QuestionsState = reduceQuestions(hello(['p1']), {
      kind: 'message',
      message: { type: 'session.status', sessionId: 's2', status: 'blocked' },
    });
    const sessions: FactorySession[] = [
      session('s1', 'blocked'),
      session('s2'),
      session('s3', 'working'),
    ];
    expect(sessionsNeedingReply(sessions, state).map((s) => s.session)).toEqual(['s2']);
    expect(effectiveStatus(session('s2', 'idle'), state.statuses)).toBe('blocked');
    expect(effectiveStatus(session('s9'), state.statuses)).toBeNull();
  });

  it('prefixes the title with the waiting count', () => {
    expect(titleWithCount('Sessions', 0)).toBe('Sessions');
    expect(titleWithCount('Sessions', 3)).toBe('(3) Sessions');
  });
});

describe('session board', () => {
  const withState = (patch: Partial<QuestionsState>): QuestionsState => ({
    ...initialQuestionsState,
    ...patch,
  });
  const names = (list: FactorySession[]): string[] => list.map((s: FactorySession) => s.session);

  it('puts a session with a pending question under Needs you, whatever herdr says', () => {
    const state: QuestionsState = withState({ pending: [pending('p1', 's1')] });
    expect(boardColumnOf(session('s1', 'working'), state)).toBe('needs-you');
    expect(boardColumnOf(session('s1', 'idle'), state)).toBe('needs-you');
  });

  it('maps blocked to Needs you, working to Working, everything else to Idle', () => {
    const state: QuestionsState = withState({});
    expect(boardColumnOf(session('a', 'blocked'), state)).toBe('needs-you');
    expect(boardColumnOf(session('a', 'working'), state)).toBe('working');
    expect(boardColumnOf(session('a', 'idle'), state)).toBe('idle');
    expect(boardColumnOf(session('a', 'done'), state)).toBe('idle');
    expect(boardColumnOf(session('a', 'unknown'), state)).toBe('idle');
    expect(boardColumnOf(session('a'), state)).toBe('idle');
  });

  it('lets the live socket status win over the polled one', () => {
    const state: QuestionsState = withState({ statuses: { a: 'working', b: 'blocked' } });
    expect(boardColumnOf(session('a', 'idle'), state)).toBe('working');
    expect(boardColumnOf(session('b', 'working'), state)).toBe('needs-you');
  });

  it('groups every session into exactly one column, keeping the list order', () => {
    const state: QuestionsState = withState({
      pending: [pending('p1', 's1'), pending('p9', 'gone')],
      statuses: { s4: 'working' },
    });
    const sessions: FactorySession[] = [
      session('s1', 'working'),
      session('s2', 'blocked'),
      session('s3', 'working'),
      session('s4', 'idle'),
      session('s5', 'done'),
      session('s6'),
    ];
    const board = groupSessions(sessions, state);
    expect(board.questions.map((p: PendingQuestion) => p.promptId)).toEqual(['p1', 'p9']);
    expect(names(board.terminal)).toEqual(['s2']);
    expect(names(board.working)).toEqual(['s3', 's4']);
    expect(names(board.idle)).toEqual(['s5', 's6']);
    expect(needsYouCount(board)).toBe(3);
  });

  it('opens the picked card, none after Later, otherwise the oldest', () => {
    const list: PendingQuestion[] = [pending('p1'), pending('p2')];
    expect(openPromptId(list, undefined)).toBe('p1');
    expect(openPromptId(list, 'p2')).toBe('p2');
    expect(openPromptId(list, null)).toBeNull();
    expect(openPromptId([pending('p2')], 'p1')).toBe('p2');
    expect(openPromptId([], undefined)).toBeNull();
  });

  it('previews one question by its text, several by count and progress', () => {
    expect(questionPreview([single], draftsFor([single]))).toBe('Which scope?');
    const drafts: Draft[] = draftsFor([single, multi]);
    expect(questionPreview([single, multi], drafts)).toBe('2 questions');
    expect(
      questionPreview([single, multi], replaceDraft(drafts, 1, { selected: ['A'], text: '' })),
    ).toBe('2 questions · 1 answered');
  });

  it('shortens names and ages', () => {
    expect(shortSessionName('factory-ask-questions-test-278abf9a')).toBe(
      'ask-questions-test-278abf9a',
    );
    expect(compactAge(2)).toBe('just now');
    expect(compactAge(45)).toBe('45s');
    expect(compactAge(20 * 60 + 5)).toBe('20m');
    expect(compactAge(2 * 3600)).toBe('2h');
    expect(compactAge(2 * 3600 + 5 * 60)).toBe('2h 5m');
    const asked: number = Date.parse('2026-10-20T10:00:00.000Z');
    expect(waitedFor('2026-10-20T10:00:00.000Z', asked + 11 * 60_000)).toBe('11m');
    expect(waitedFor('not a date', asked)).toBe('');
  });
});

describe('questions on the run page', () => {
  const asked = (promptId: string, run?: PendingQuestion['run']): PendingQuestion => ({
    sessionId: 'factory-ask-1',
    promptId,
    toolUseId: '',
    questions: [single],
    askedAt: '2026-10-21T20:00:00.000Z',
    ...(run ? { run } : {}),
  });

  it('keeps the questions of this run only, in order', () => {
    const here = { pipelineId: 'ask', runId: 'r-1', match: 'session' as const };
    const pending: PendingQuestion[] = [
      asked('a', here),
      asked('b', { ...here, runId: 'r-2' }),
      asked('c'),
      asked('d', { ...here, match: 'started-after' }),
    ];
    expect(
      questionsForRun(pending, { pipelineId: 'ask', runId: 'r-1' }).map((p) => p.promptId),
    ).toEqual(['a', 'd']);
    expect(questionsForRun(pending, { pipelineId: 'other', runId: 'r-1' })).toEqual([]);
  });

  it('the protocol carries the run link, and a question without one still parses', () => {
    const withRun = serverMessageSchema.parse({
      type: 'session.question',
      question: asked('a', { pipelineId: 'ask', runId: 'r-1', match: 'session' }),
    });
    expect(withRun.type === 'session.question' && withRun.question.run?.runId).toBe('r-1');
    const without = serverMessageSchema.parse({ type: 'hello', pending: [asked('b')] });
    expect(without.type === 'hello' && without.pending[0]?.run).toBeUndefined();
  });
});

describe('websocket helpers', () => {
  it('backs off and caps', () => {
    expect([0, 1, 2, 3, 4, 10].map((n: number) => reconnectDelay(n))).toEqual([
      1000, 2000, 4000, 8000, 15000, 15000,
    ]);
  });

  it('picks ws or wss from the page', () => {
    expect(socketUrlFor({ protocol: 'http:', host: 'localhost:5175' }, '/api/v1/ws')).toBe(
      'ws://localhost:5175/api/v1/ws',
    );
    expect(socketUrlFor({ protocol: 'https:', host: 'a.b' }, '/api/v1/ws')).toBe(
      'wss://a.b/api/v1/ws',
    );
  });
});
