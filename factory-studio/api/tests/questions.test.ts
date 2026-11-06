import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { createFsClient } from '../src/clients/fs/fs.client.js';
import {
  createQuestionJournal,
  createQuestionLifecycle,
  createQuestionStore,
  handleClientMessageFactory,
} from '../src/features/questions/index.js';
import type { QuestionLifecycle } from '../src/features/questions/index.js';
import type {
  AskUserQuestionPayload,
  Broadcast,
  HookOutcome,
  PendingQuestion,
  QuestionJournal,
  QuestionRecord,
  QuestionStore,
  QuestionUsecases,
  ServerMessage,
} from '../src/features/questions/questions.types.js';
import {
  answerQuestionFactory,
  dismissQuestionFactory,
  reconcileQuestionsFactory,
  registerQuestionFactory,
  resolveQuestionFactory,
  restoreQuestionsFactory,
} from '../src/features/questions/usecases/index.js';
import { attachWebSocket, type WsHub } from '../src/shared/ws/index.js';
import {
  askUntilAnswered,
  buildAllowOutput,
  buildAskBody,
  buildResolvedBody,
  decideNext,
  decideOutput,
} from '../hooks/studio-question-hook.mjs';
import { fakeHerdr, workspace, type FakeHerdr } from './helpers.js';
import { buildTestApp, makeWorkDir, quiet, type WorkDir } from './work-dir.js';

const QUESTION_INPUT = {
  questions: [
    {
      header: 'Size',
      question: 'Size?',
      multiSelect: false,
      options: [
        { label: 'S', description: 'small' },
        { label: 'M', description: 'medium' },
      ],
    },
    {
      header: 'Toppings',
      question: 'Which toppings?',
      multiSelect: true,
      options: [
        { label: 'Ham', description: '' },
        { label: 'Olives', description: '' },
      ],
    },
  ],
};

const ASK = {
  sessionId: 'factory-research-aaaaaaaa',
  claudeSessionId: 'c1',
  toolUseId: 'toolu_1',
  toolInput: QUESTION_INPUT,
};

interface Harness {
  store: QuestionStore;
  sent: ServerMessage[];
  usecases: QuestionUsecases;
  lifecycle: QuestionLifecycle;
}

interface HarnessOptions {
  longPollMs?: number;
  journal?: QuestionJournal;
  now?: () => Date;
}

const harness = ({ longPollMs, journal, now }: HarnessOptions = {}): Harness => {
  const store: QuestionStore = createQuestionStore();
  const sent: ServerMessage[] = [];
  const broadcast: Broadcast = (message: ServerMessage): void => {
    sent.push(message);
  };
  const lifecycle: QuestionLifecycle = createQuestionLifecycle({
    store,
    broadcast,
    journal,
    longPollMs,
    now,
  });
  let n = 0;
  return {
    store,
    sent,
    lifecycle,
    usecases: {
      registerQuestion: registerQuestionFactory({
        store,
        lifecycle,
        newUuid: (): string => `prompt-${++n}`,
        now,
      }),
      answerQuestion: answerQuestionFactory({ store }),
      dismissQuestion: dismissQuestionFactory({ store }),
      resolveQuestion: resolveQuestionFactory({ store }),
      listPending: store.list,
    },
  };
};

/** A journal over a temp folder, through the real fs client. */
const tempJournal = async (): Promise<{ dir: string; journal: QuestionJournal }> => {
  const dir: string = await mkdtemp(path.join(os.tmpdir(), 'studio-questions-'));
  return { dir, journal: createQuestionJournal({ fs: createFsClient({}), dir }) };
};

const settle = async (): Promise<void> => {
  await new Promise((r): void => void setTimeout(r, 20));
};

const ANSWERS = [
  { question: 'Size?', selected: ['M'] },
  { question: 'Which toppings?', selected: ['Ham', 'Olives'] },
];

describe('question usecases', () => {
  it('register broadcasts the question, then answer releases the waiting hook', async () => {
    const h: Harness = harness();
    const waiting = h.usecases.registerQuestion(ASK);
    expect(h.sent[0]).toMatchObject({
      type: 'session.question',
      question: { sessionId: ASK.sessionId, promptId: 'prompt-1', toolUseId: 'toolu_1' },
    });
    expect(h.usecases.listPending()).toHaveLength(1);

    expect(
      h.usecases.answerQuestion({
        sessionId: ASK.sessionId,
        promptId: 'prompt-1',
        answers: ANSWERS,
      }),
    ).toEqual({ ok: true });
    expect(await waiting).toEqual({
      action: 'answer',
      answers: { 'Size?': 'M', 'Which toppings?': 'Ham, Olives' },
    });
    expect(h.sent[1]).toEqual({
      type: 'session.question.resolved',
      sessionId: ASK.sessionId,
      promptId: 'prompt-1',
      reason: 'answered',
    });
    expect(h.usecases.listPending()).toEqual([]);
  });

  it('refuses answers that do not fit and keeps the question pending', async () => {
    const h: Harness = harness();
    void h.usecases.registerQuestion(ASK);
    const result = h.usecases.answerQuestion({
      sessionId: ASK.sessionId,
      promptId: 'prompt-1',
      answers: [{ question: 'Size?', selected: ['M'] }],
    });
    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
    expect(h.usecases.listPending()).toHaveLength(1);
    expect(
      h.usecases.answerQuestion({ sessionId: 'other', promptId: 'prompt-1', answers: ANSWERS }),
    ).toEqual({ ok: false, reason: 'not-found' });
  });

  it('dismiss releases the hook with "use the terminal"', async () => {
    const h: Harness = harness();
    const waiting = h.usecases.registerQuestion(ASK);
    h.usecases.dismissQuestion({ sessionId: ASK.sessionId, promptId: 'prompt-1' });
    expect(await waiting).toEqual({ action: 'dismiss' });
    expect(h.sent[1]).toMatchObject({ reason: 'dismissed' });
  });

  it('an abort (the hook request went away) detaches the hook and keeps the question', async () => {
    const h: Harness = harness();
    const gone: AbortController = new AbortController();
    const waiting = h.usecases.registerQuestion(ASK, gone.signal);
    gone.abort();
    expect(await waiting).toEqual({ action: 'wait' });
    expect(h.usecases.listPending()).toHaveLength(1);
    expect(h.store.get(ASK.sessionId, 'prompt-1')?.waiter).toBeNull();
    expect(h.store.get(ASK.sessionId, 'prompt-1')?.detachedAt).not.toBeNull();
    expect(
      h.sent.filter((m: ServerMessage): boolean => m.type === 'session.question.resolved'),
    ).toEqual([]);
    // The hook asks again: the same question, the same promptId, no second broadcast.
    const again = h.usecases.registerQuestion(ASK);
    await settle();
    expect(h.usecases.listPending().map((p: PendingQuestion): string => p.promptId)).toEqual([
      'prompt-1',
    ]);
    expect(
      h.sent.filter((m: ServerMessage): boolean => m.type === 'session.question'),
    ).toHaveLength(1);
    h.usecases.dismissQuestion({ sessionId: ASK.sessionId, promptId: 'prompt-1' });
    expect(await again).toEqual({ action: 'dismiss' });
    expect(h.usecases.listPending()).toEqual([]);
  });

  it('the long poll ends with wait; the question stays and is taken up again', async () => {
    const h: Harness = harness({ longPollMs: 100 });
    expect(await h.usecases.registerQuestion(ASK)).toEqual({ action: 'wait' });
    expect(h.usecases.listPending()).toHaveLength(1);
    const again = h.usecases.registerQuestion(ASK);
    h.usecases.answerQuestion({ sessionId: ASK.sessionId, promptId: 'prompt-1', answers: ANSWERS });
    expect(await again).toMatchObject({ action: 'answer' });
  });

  it('an answer given while the hook is away is queued and handed over on its next request', async () => {
    const h: Harness = harness();
    const gone: AbortController = new AbortController();
    const cut = h.usecases.registerQuestion(ASK, gone.signal);
    gone.abort();
    expect(await cut).toEqual({ action: 'wait' });
    expect(
      h.usecases.answerQuestion({
        sessionId: ASK.sessionId,
        promptId: 'prompt-1',
        answers: ANSWERS,
      }),
    ).toEqual({ ok: true });
    // The clients see it resolved; a second answer finds nothing to answer.
    expect(h.sent.at(-1)).toMatchObject({ type: 'session.question.resolved', reason: 'answered' });
    expect(
      h.usecases.answerQuestion({
        sessionId: ASK.sessionId,
        promptId: 'prompt-1',
        answers: ANSWERS,
      }),
    ).toEqual({ ok: false, reason: 'not-found' });
    expect(h.store.get(ASK.sessionId, 'prompt-1')?.queued).toMatchObject({ action: 'answer' });
    expect(await h.usecases.registerQuestion(ASK)).toEqual({
      action: 'answer',
      answers: { 'Size?': 'M', 'Which toppings?': 'Ham, Olives' },
    });
    expect(h.store.entries()).toEqual([]);
  });

  it('a question in the terminal cannot be answered or dismissed from the app', async () => {
    const h: Harness = harness();
    const gone: AbortController = new AbortController();
    void h.usecases.registerQuestion(ASK, gone.signal);
    gone.abort();
    await settle();
    h.lifecycle.markTerminal('prompt-1');
    expect(h.sent.at(-1)).toMatchObject({
      type: 'session.question',
      question: { promptId: 'prompt-1', channel: 'terminal' },
    });
    expect(
      h.usecases.answerQuestion({
        sessionId: ASK.sessionId,
        promptId: 'prompt-1',
        answers: ANSWERS,
      }),
    ).toMatchObject({ ok: false, reason: 'invalid' });
    expect(
      h.usecases.dismissQuestion({ sessionId: ASK.sessionId, promptId: 'prompt-1' }),
    ).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    // The hook coming back after all takes it up again as its own.
    const back = h.usecases.registerQuestion(ASK);
    await settle();
    expect(h.sent.at(-1)).toMatchObject({ question: { promptId: 'prompt-1', channel: 'hook' } });
    h.usecases.resolveQuestion({ sessionId: ASK.sessionId, toolUseId: 'toolu_1' });
    expect(await back).toEqual({ action: 'dismiss' });
  });

  it('PostToolUse for a still-pending question clears it as terminal', async () => {
    const h: Harness = harness();
    const waiting = h.usecases.registerQuestion(ASK);
    h.usecases.resolveQuestion({ sessionId: ASK.sessionId, toolUseId: 'toolu_1' });
    await waiting;
    expect(h.sent[1]).toMatchObject({ reason: 'terminal' });
    // already settled: nothing more is broadcast
    h.usecases.resolveQuestion({ sessionId: ASK.sessionId, toolUseId: 'toolu_1' });
    expect(h.sent).toHaveLength(2);
  });
});

describe('question run link', () => {
  it('attaches the run locateRun finds to the broadcast and the pending list', async () => {
    const store: QuestionStore = createQuestionStore();
    const sent: ServerMessage[] = [];
    const seen: AskUserQuestionPayload[] = [];
    const register = registerQuestionFactory({
      store,
      lifecycle: createQuestionLifecycle({
        store,
        broadcast: (message: ServerMessage): void => {
          sent.push(message);
        },
      }),
      locateRun: async (payload: AskUserQuestionPayload) => {
        seen.push(payload);
        return { pipelineId: 'ask-factory', runId: 'r-1', match: 'session' };
      },
      newUuid: (): string => 'prompt-1',
    });
    const waiting: Promise<HookOutcome> = register(ASK);
    await vi.waitFor((): void => expect(sent).toHaveLength(1));
    expect(seen[0]?.claudeSessionId).toBe('c1');
    expect(sent[0]).toMatchObject({
      type: 'session.question',
      question: { run: { pipelineId: 'ask-factory', runId: 'r-1', match: 'session' } },
    });
    expect(store.list()[0]?.run?.runId).toBe('r-1');
    store.get(ASK.sessionId, 'prompt-1')?.settle({ action: 'dismiss' });
    await expect(waiting).resolves.toEqual({ action: 'dismiss' });
  });

  it('a lookup that fails still registers the question, without a run', async () => {
    const store: QuestionStore = createQuestionStore();
    const sent: ServerMessage[] = [];
    const register = registerQuestionFactory({
      store,
      lifecycle: createQuestionLifecycle({
        store,
        broadcast: (message: ServerMessage): void => {
          sent.push(message);
        },
      }),
      locateRun: async () => {
        throw new Error('disk gone');
      },
      newUuid: (): string => 'prompt-1',
    });
    const waiting: Promise<HookOutcome> = register(ASK);
    await vi.waitFor((): void => expect(sent).toHaveLength(1));
    const first: ServerMessage | undefined = sent[0];
    expect(first?.type === 'session.question' && first.question.run).toBeUndefined();
    store.get(ASK.sessionId, 'prompt-1')?.settle({ action: 'dismiss' });
    await waiting;
  });
});

describe('hook endpoints over HTTP', () => {
  let work: WorkDir;
  let server: Server;
  let base: string;
  const sent: ServerMessage[] = [];
  const store: QuestionStore = createQuestionStore();

  beforeAll(async () => {
    work = await makeWorkDir();
    const app = buildTestApp(work, fakeHerdr().client, {
      questionStore: store,
      broadcast: (m: ServerMessage): void => {
        sent.push(m);
      },
    });
    server = createServer(app);
    await new Promise<void>((resolve): void => {
      server.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve): void => {
      server.close((): void => resolve());
    });
    await work.cleanup();
  });
  beforeEach(() => {
    sent.length = 0;
  });

  const post = (p: string, body: unknown, signal?: AbortSignal): Promise<Response> =>
    fetch(`${base}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

  const pendingId = async (): Promise<string> => {
    for (let i = 0; i < 100 && store.list().length === 0; i++) {
      await new Promise((r): void => void setTimeout(r, 10));
    }
    const first: PendingQuestion | undefined = store.list()[0];
    if (!first) throw new Error('no pending question');
    return first.promptId;
  };

  it('the long poll is resolved by POST /sessions/answer', async () => {
    const poll: Promise<Response> = post('/hooks/ask-user-question', ASK);
    const promptId: string = await pendingId();
    const answered: Response = await post('/sessions/answer', {
      sessionId: ASK.sessionId,
      promptId,
      answers: ANSWERS,
    });
    expect(answered.status).toBe(200);
    const res: Response = await poll;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      action: 'answer',
      answers: { 'Size?': 'M', 'Which toppings?': 'Ham, Olives' },
    });
  });

  it('answering a prompt that is gone is 404, a bad answer is 400', async () => {
    const gone: Response = await post('/sessions/answer', {
      sessionId: 's',
      promptId: 'nope',
      answers: ANSWERS,
    });
    expect(gone.status).toBe(404);
    const poll: Promise<Response> = post('/hooks/ask-user-question', ASK);
    const promptId: string = await pendingId();
    const bad: Response = await post('/sessions/answer', {
      sessionId: ASK.sessionId,
      promptId,
      answers: [{ question: 'Size?', selected: ['XL'] }],
    });
    expect(bad.status).toBe(400);
    expect((await post('/sessions/dismiss', { sessionId: ASK.sessionId, promptId })).status).toBe(
      200,
    );
    expect(await (await poll).json()).toEqual({ action: 'dismiss' });
  });

  it('a hook that disconnects leaves the question pending, detached; GET /questions lists it', async () => {
    const abort: AbortController = new AbortController();
    const poll: Promise<Response> = post('/hooks/ask-user-question', ASK, abort.signal);
    poll.catch((): void => {});
    const promptId: string = await pendingId();
    abort.abort();
    await vi.waitFor((): void => {
      expect(store.get(ASK.sessionId, promptId)?.waiter).toBeNull();
    });
    expect(store.list()).toHaveLength(1);
    expect(sent.some((m: ServerMessage): boolean => m.type === 'session.question.resolved')).toBe(
      false,
    );
    const listed: Response = await fetch(`${base}/questions`);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({
      count: 1,
      pending: [{ promptId, channel: 'hook', questions: QUESTION_INPUT.questions }],
    });
    // The hook asks again and gets the same question; a dismiss ends it.
    const again: Promise<Response> = post('/hooks/ask-user-question', ASK);
    await vi.waitFor((): void => {
      expect(store.get(ASK.sessionId, promptId)?.waiter).not.toBeNull();
    });
    expect((await post('/sessions/dismiss', { sessionId: ASK.sessionId, promptId })).status).toBe(
      200,
    );
    expect(await (await again).json()).toEqual({ action: 'dismiss' });
    expect(await (await fetch(`${base}/questions`)).json()).toEqual({ count: 0, pending: [] });
  });

  it('question-resolved settles a pending question and rejects a malformed body', async () => {
    const poll: Promise<Response> = post('/hooks/ask-user-question', ASK);
    await pendingId();
    expect(
      (await post('/hooks/question-resolved', { sessionId: ASK.sessionId, toolUseId: 'toolu_1' }))
        .status,
    ).toBe(200);
    expect(await (await poll).json()).toEqual({ action: 'dismiss' });
    expect((await post('/hooks/ask-user-question', { sessionId: 'x' })).status).toBe(400);
  });
});

describe('durable questions', () => {
  let dir: string;
  let journal: QuestionJournal;
  beforeEach(async () => {
    ({ dir, journal } = await tempJournal());
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const records = async (): Promise<QuestionRecord[]> => journal.list();

  it('writes the question when the hook posts it and rewrites it with the answer', async () => {
    const h: Harness = harness({ journal, now: (): Date => new Date('2026-11-02T10:00:00.000Z') });
    const waiting = h.usecases.registerQuestion(ASK);
    await settle();
    expect(await readdir(dir)).toEqual(['prompt-1.json']);
    expect((await records())[0]).toMatchObject({
      sessionId: ASK.sessionId,
      promptId: 'prompt-1',
      toolUseId: 'toolu_1',
      claudeSessionId: 'c1',
      status: 'pending',
      channel: 'hook',
      askedAt: '2026-11-02T10:00:00.000Z',
      questions: QUESTION_INPUT.questions,
    });
    h.usecases.answerQuestion({ sessionId: ASK.sessionId, promptId: 'prompt-1', answers: ANSWERS });
    await waiting;
    await settle();
    expect((await records())[0]).toMatchObject({
      status: 'answered',
      delivered: true,
      answers: { 'Size?': 'M', 'Which toppings?': 'Ham, Olives' },
      resolvedAt: '2026-11-02T10:00:00.000Z',
    });
  });

  it('a restart restores the pending question in full, and the hook finds it under the old promptId', async () => {
    const first: Harness = harness({ journal });
    const gone: AbortController = new AbortController();
    void first.usecases.registerQuestion(ASK, gone.signal);
    await settle();
    gone.abort(); // the API dies: the hook request is cut

    // A fresh API over the same folder.
    const second: Harness = harness({ journal });
    const restore = restoreQuestionsFactory({ journal, lifecycle: second.lifecycle });
    expect(await restore()).toBe(1);
    expect(second.usecases.listPending()).toMatchObject([
      {
        promptId: 'prompt-1',
        sessionId: ASK.sessionId,
        channel: 'hook',
        questions: QUESTION_INPUT.questions,
      },
    ]);
    // The hook asks again (its retry loop) and is attached to the restored question.
    const again = second.usecases.registerQuestion(ASK);
    await settle();
    expect(
      second.sent.filter((m: ServerMessage): boolean => m.type === 'session.question'),
    ).toEqual([]);
    expect(
      second.usecases.answerQuestion({
        sessionId: ASK.sessionId,
        promptId: 'prompt-1',
        answers: ANSWERS,
      }),
    ).toEqual({ ok: true });
    expect(await again).toMatchObject({ action: 'answer' });
    await settle();
    expect((await records())[0]).toMatchObject({ status: 'answered', delivered: true });
    // Restoring again finds nothing open.
    expect(
      await restoreQuestionsFactory({ journal, lifecycle: harness({ journal }).lifecycle })(),
    ).toBe(0);
  });

  it('an answer queued before the restart is handed to the hook after it', async () => {
    const first: Harness = harness({ journal });
    const gone: AbortController = new AbortController();
    void first.usecases.registerQuestion(ASK, gone.signal);
    await settle();
    gone.abort();
    await settle();
    first.usecases.answerQuestion({
      sessionId: ASK.sessionId,
      promptId: 'prompt-1',
      answers: ANSWERS,
    });
    await settle();
    expect((await records())[0]).toMatchObject({ status: 'answered', delivered: false });

    const second: Harness = harness({ journal });
    expect(await restoreQuestionsFactory({ journal, lifecycle: second.lifecycle })()).toBe(1);
    expect(await second.usecases.registerQuestion(ASK)).toEqual({
      action: 'answer',
      answers: { 'Size?': 'M', 'Which toppings?': 'Ham, Olives' },
    });
    await settle();
    expect((await records())[0]).toMatchObject({ status: 'answered', delivered: true });
    expect(second.usecases.listPending()).toEqual([]);
  });

  it('skips a file that is not a question record and keeps the rest', async () => {
    await writeFile(path.join(dir, 'junk.json'), '{ nope', 'utf8');
    await writeFile(path.join(dir, 'other.json'), JSON.stringify({ hello: 1 }), 'utf8');
    const h: Harness = harness({ journal });
    void h.usecases.registerQuestion(ASK);
    await settle();
    expect((await records()).map((r: QuestionRecord): string => r.promptId)).toEqual(['prompt-1']);
    expect(JSON.parse(await readFile(path.join(dir, 'prompt-1.json'), 'utf8')).status).toBe(
      'pending',
    );
  });

  it('reconcile: a session gone for the grace ends its questions, a hook away for the grace marks the terminal', async () => {
    let at = 1_000_000;
    const now = (): Date => new Date(at);
    const h: Harness = harness({ journal, now });
    const reconcile = reconcileQuestionsFactory({
      store: h.store,
      lifecycle: h.lifecycle,
      detachGraceMs: 30_000,
      goneGraceMs: 15_000,
      now,
    });
    const gone: AbortController = new AbortController();
    void h.usecases.registerQuestion(ASK, gone.signal);
    await settle();
    gone.abort();
    await settle();
    // Attached hook just left: nothing yet.
    reconcile([ASK.sessionId]);
    expect(h.usecases.listPending()[0]?.channel).toBe('hook');
    at += 31_000;
    reconcile([ASK.sessionId]);
    expect(h.usecases.listPending()[0]?.channel).toBe('terminal');
    expect(h.sent.at(-1)).toMatchObject({
      type: 'session.question',
      question: { channel: 'terminal' },
    });
    await settle();
    expect((await records())[0]).toMatchObject({ status: 'pending', channel: 'terminal' });
    // The session vanishes from herdr: one empty poll is not enough, a grace of them is.
    reconcile([]);
    expect(h.usecases.listPending()).toHaveLength(1);
    at += 16_000;
    reconcile([]);
    expect(h.usecases.listPending()).toEqual([]);
    expect(h.sent.at(-1)).toMatchObject({ type: 'session.question.resolved', reason: 'gone' });
    await settle();
    expect((await records())[0]).toMatchObject({ status: 'gone' });
  });

  it('PostToolUse on a terminal-bound question closes it as terminal', async () => {
    const h: Harness = harness({ journal });
    const gone: AbortController = new AbortController();
    void h.usecases.registerQuestion(ASK, gone.signal);
    await settle();
    gone.abort();
    await settle();
    h.lifecycle.markTerminal('prompt-1');
    h.usecases.resolveQuestion({ sessionId: ASK.sessionId, toolUseId: 'toolu_1' });
    expect(h.usecases.listPending()).toEqual([]);
    expect(h.sent.at(-1)).toMatchObject({ type: 'session.question.resolved', reason: 'terminal' });
    await settle();
    expect((await records())[0]).toMatchObject({ status: 'terminal' });
  });
});

describe('WebSocket', () => {
  let work: WorkDir;
  let server: Server;
  let hub: WsHub;
  let url: string;
  let herdr: FakeHerdr;
  const store: QuestionStore = createQuestionStore();
  const KEY = 'k'.repeat(16);

  beforeAll(async () => {
    work = await makeWorkDir();
    herdr = fakeHerdr([workspace('w1', 'factory-research-aaaaaaaa', 'blocked')]);
    let broadcast: Broadcast = (): void => {};
    const app = buildTestApp(work, herdr.client, {
      questionStore: store,
      broadcast: (m: ServerMessage): void => broadcast(m),
    });
    server = createServer(app);
    const lifecycle: QuestionLifecycle = createQuestionLifecycle({
      store,
      broadcast: (m): void => broadcast(m),
    });
    const usecases: QuestionUsecases = {
      registerQuestion: registerQuestionFactory({ store, lifecycle }),
      answerQuestion: answerQuestionFactory({ store }),
      dismissQuestion: dismissQuestionFactory({ store }),
      resolveQuestion: resolveQuestionFactory({ store }),
      listPending: store.list,
    };
    const { replySessionFactory } = await import('../src/features/sessions/index.js');
    const { listSessionsFactory } = await import('../src/features/sessions/index.js');
    const listSessions = listSessionsFactory({
      herdr: herdr.client,
      readMeta: async (): Promise<null> => null,
    });
    const reply = replySessionFactory({ herdr: herdr.client, listSessions });
    const onMessage = handleClientMessageFactory({ usecases, replySession: reply, logger: quiet });
    hub = attachWebSocket({
      server,
      path: '/api/v1/ws',
      apiKey: KEY,
      logger: quiet,
      onConnect: (): unknown => ({ type: 'hello', pending: store.list() }),
      onMessage,
    });
    broadcast = hub.broadcast;
    (globalThis as { __usecases?: QuestionUsecases }).__usecases = usecases;
    await new Promise<void>((resolve): void => {
      server.listen(0, '127.0.0.1', resolve);
    });
    url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/ws`;
  });
  afterAll(async () => {
    await hub.close();
    server.closeAllConnections();
    await new Promise<void>((resolve): void => {
      server.close((): void => resolve());
    });
    await work.cleanup();
  });

  const connect = (query: string, headers: Record<string, string> = {}) =>
    new Promise<{ ws: WebSocket; frames: ServerMessage[]; next: () => Promise<ServerMessage> }>(
      (resolve, reject): void => {
        const ws: WebSocket = new WebSocket(`${url}${query}`, { headers });
        const frames: ServerMessage[] = [];
        const waiters: ((m: ServerMessage) => void)[] = [];
        ws.on('message', (data): void => {
          const message = JSON.parse(String(data)) as ServerMessage;
          const waiter = waiters.shift();
          if (waiter) waiter(message);
          else frames.push(message);
        });
        const next = (): Promise<ServerMessage> =>
          new Promise<ServerMessage>((res): void => {
            const queued = frames.shift();
            if (queued) res(queued);
            else waiters.push(res);
          });
        ws.once('open', (): void => resolve({ ws, frames, next }));
        ws.once('error', reject);
        ws.once('unexpected-response', (_req, res): void =>
          reject(new Error(`status ${res.statusCode}`)),
        );
      },
    );

  it('refuses a missing or wrong key, accepts ?key= and the header', async () => {
    await expect(connect('')).rejects.toThrow('401');
    await expect(connect('?key=wrong')).rejects.toThrow('401');
    const viaQuery = await connect(`?key=${KEY}`);
    expect((await viaQuery.next()).type).toBe('hello');
    viaQuery.ws.close();
    const viaHeader = await connect('', { 'x-api-key': KEY });
    expect((await viaHeader.next()).type).toBe('hello');
    viaHeader.ws.close();
  });

  it('hello lists pending, a registered question is pushed, an answer over ws releases the hook', async () => {
    const usecases = (globalThis as unknown as { __usecases: QuestionUsecases }).__usecases;
    const a = await connect(`?key=${KEY}`);
    const b = await connect(`?key=${KEY}`);
    expect(await a.next()).toEqual({ type: 'hello', pending: [] });
    await b.next();

    const waiting = usecases.registerQuestion(ASK);
    const pushedA = await a.next();
    const pushedB = await b.next();
    expect(pushedA).toMatchObject({ type: 'session.question' });
    expect(pushedB).toEqual(pushedA);
    if (pushedA.type !== 'session.question') throw new Error('unreachable');

    const late = await connect(`?key=${KEY}`);
    expect(await late.next()).toMatchObject({
      type: 'hello',
      pending: [{ promptId: pushedA.question.promptId }],
    });

    a.ws.send(
      JSON.stringify({
        type: 'session.answer',
        sessionId: ASK.sessionId,
        promptId: pushedA.question.promptId,
        answers: ANSWERS,
      }),
    );
    expect(await waiting).toMatchObject({ action: 'answer' });
    expect(await b.next()).toMatchObject({ type: 'session.question.resolved', reason: 'answered' });
    for (const c of [a, b, late]) c.ws.close();
  });

  it('answers a bad frame or a stale prompt with an error frame, and replies into the pane', async () => {
    const c = await connect(`?key=${KEY}`);
    await c.next();
    c.ws.send('not json');
    expect(await c.next()).toEqual({ type: 'error', message: 'invalid message' });
    c.ws.send(JSON.stringify({ type: 'session.dismiss', sessionId: 's', promptId: 'gone' }));
    expect(await c.next()).toMatchObject({ type: 'error', ref: 'session.dismiss' });

    c.ws.send(
      JSON.stringify({
        type: 'session.reply',
        sessionId: 'factory-research-aaaaaaaa',
        text: 'yes',
      }),
    );
    for (let i = 0; i < 100 && herdr.workspaces[0]?.keys.length === 0; i++) {
      await new Promise((r): void => void setTimeout(r, 10));
    }
    expect(herdr.workspaces[0]?.texts).toEqual(['yes']);
    expect(herdr.workspaces[0]?.keys).toEqual([['Enter']]);

    c.ws.send(JSON.stringify({ type: 'session.reply', sessionId: 'nope', text: 'x' }));
    expect(await c.next()).toMatchObject({ type: 'error', ref: 'session.reply' });
    c.ws.close();
  });
});

describe('hook script', () => {
  const event = {
    hook_event_name: 'PreToolUse',
    session_id: 'c1',
    transcript_path: '/t.jsonl',
    tool_use_id: 'toolu_1',
    tool_input: QUESTION_INPUT,
  };

  it('builds the ask body from the hook event', () => {
    expect(buildAskBody(event, 'sess')).toEqual({
      sessionId: 'sess',
      claudeSessionId: 'c1',
      transcriptPath: '/t.jsonl',
      toolUseId: 'toolu_1',
      toolInput: QUESTION_INPUT,
    });
    expect(buildResolvedBody({ ...event, tool_response: { answers: { a: 'b' } } }, 'sess')).toEqual(
      {
        sessionId: 'sess',
        toolUseId: 'toolu_1',
        answers: { a: 'b' },
      },
    );
  });

  it('allows with the answers merged into the tool input; prints nothing otherwise', () => {
    const answers = { 'Size?': 'M' };
    expect(decideOutput(QUESTION_INPUT, { action: 'answer', answers })).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: { ...QUESTION_INPUT, answers },
      },
    });
    expect(buildAllowOutput({ a: 1 }, { q: 'x' }).hookSpecificOutput.updatedInput).toEqual({
      a: 1,
      answers: { q: 'x' },
    });
    expect(decideOutput(QUESTION_INPUT, { action: 'dismiss' })).toBeNull();
    expect(decideOutput(QUESTION_INPUT, null)).toBeNull();
  });

  it('retries an unreachable or failing API, asks again on wait, gives up on a refusal', () => {
    expect(decideNext({ status: 0, body: null })).toBe('retry');
    expect(decideNext({ status: 502, body: null })).toBe('retry');
    expect(decideNext({ status: 200, body: { action: 'wait' } })).toBe('again');
    expect(decideNext({ status: 200, body: { action: 'answer', answers: {} } })).toBe('done');
    expect(decideNext({ status: 200, body: { action: 'dismiss' } })).toBe('done');
    expect(decideNext({ status: 400, body: { error: 'bad' } })).toBe('give-up');
    expect(decideNext({ status: 401, body: null })).toBe('give-up');
  });

  it('askUntilAnswered keeps asking through outages and waits until a final reply', async () => {
    const results = [
      { status: 0, body: null },
      { status: 503, body: null },
      { status: 200, body: { action: 'wait' } },
      { status: 200, body: { action: 'answer', answers: { q: 'a' } } },
    ];
    const seen: unknown[] = [];
    const post = async (body: unknown): Promise<unknown> => {
      seen.push(body);
      return results.shift();
    };
    expect(await askUntilAnswered(post, { x: 1 }, 1)).toEqual({
      action: 'answer',
      answers: { q: 'a' },
    });
    expect(seen).toHaveLength(4);
    expect(await askUntilAnswered(async () => ({ status: 400, body: null }), {}, 1)).toBeNull();
  });

  describe('as a process', () => {
    const script: string = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'hooks',
      'studio-question-hook.mjs',
    );
    let server: Server;
    let origin: string;
    let received: unknown;
    let reply: unknown;
    /** Replies given before `reply`, one per request: a `wait` first, then the answer. */
    let replies: unknown[] = [];
    let requests = 0;

    beforeAll(async () => {
      server = createServer((req, res): void => {
        const parts: Buffer[] = [];
        req.on('data', (p: Buffer): void => void parts.push(p));
        req.on('end', (): void => {
          requests += 1;
          received = {
            url: req.url,
            key: req.headers['x-api-key'],
            body: JSON.parse(Buffer.concat(parts).toString()),
          };
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(replies.length > 0 ? replies.shift() : reply));
        });
      });
      await new Promise<void>((resolve): void => {
        server.listen(0, '127.0.0.1', resolve);
      });
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => {
      server.closeAllConnections();
      server.close();
    });
    afterEach(() => {
      received = undefined;
      replies = [];
      requests = 0;
    });

    const run = (input: unknown, env: Record<string, string>): Promise<string> =>
      new Promise<string>((resolve, reject): void => {
        const child = spawn(process.execPath, [script], {
          env: { PATH: process.env.PATH ?? '', ...env },
        });
        let out = '';
        child.stdout.on('data', (d: Buffer): void => void (out += d.toString()));
        child.on('error', reject);
        child.on('close', (code): void =>
          code === 0 ? resolve(out) : reject(new Error(`exit ${code}`)),
        );
        child.stdin.end(JSON.stringify(input));
      });

    it('prints the allow JSON when the API answers', async () => {
      reply = { action: 'answer', answers: { 'Size?': 'M' } };
      const out: string = await run(event, {
        STUDIO_SESSION_ID: 'sess',
        STUDIO_API_URL: origin,
        STUDIO_API_KEY: 'secret-key-123456',
      });
      expect(JSON.parse(out).hookSpecificOutput.updatedInput.answers).toEqual({ 'Size?': 'M' });
      expect(received).toMatchObject({
        url: '/api/v1/hooks/ask-user-question',
        key: 'secret-key-123456',
        body: { sessionId: 'sess', toolUseId: 'toolu_1' },
      });
    });

    it('prints nothing on dismiss or with no studio env', async () => {
      reply = { action: 'dismiss' };
      expect(await run(event, { STUDIO_SESSION_ID: 's', STUDIO_API_URL: origin })).toBe('');
      expect(await run(event, {})).toBe('');
    });

    it('asks again at once after a wait, and takes the answer of the second request', async () => {
      replies = [{ action: 'wait' }, { action: 'wait' }];
      reply = { action: 'answer', answers: { 'Size?': 'S' } };
      const out: string = await run(event, { STUDIO_SESSION_ID: 's', STUDIO_API_URL: origin });
      expect(JSON.parse(out).hookSpecificOutput.updatedInput.answers).toEqual({ 'Size?': 'S' });
      expect(requests).toBe(3);
    });

    it('PostToolUse posts question-resolved and prints nothing', async () => {
      reply = { ok: true };
      const out: string = await run(
        { ...event, hook_event_name: 'PostToolUse', tool_response: { answers: { a: 'b' } } },
        { STUDIO_SESSION_ID: 's', STUDIO_API_URL: origin },
      );
      expect(out).toBe('');
      expect(received).toMatchObject({ url: '/api/v1/hooks/question-resolved' });
    });

    it('SessionStart posts the transcript path and prints nothing', async () => {
      reply = { ok: true };
      const out: string = await run(
        {
          hook_event_name: 'SessionStart',
          session_id: 'c-1',
          transcript_path: '/home/u/.claude/projects/-w/c-1.jsonl',
          source: 'startup',
        },
        { STUDIO_SESSION_ID: 's', STUDIO_API_URL: origin },
      );
      expect(out).toBe('');
      expect(received).toMatchObject({
        url: '/api/v1/hooks/session-start',
        body: {
          sessionId: 's',
          claudeSessionId: 'c-1',
          transcriptPath: '/home/u/.claude/projects/-w/c-1.jsonl',
          source: 'startup',
        },
      });
    });
  });
});
