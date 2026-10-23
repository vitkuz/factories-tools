import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import {
  createQuestionStore,
  handleClientMessageFactory,
} from '../src/features/questions/index.js';
import type {
  AskUserQuestionPayload,
  Broadcast,
  HookOutcome,
  PendingQuestion,
  QuestionStore,
  QuestionUsecases,
  ServerMessage,
} from '../src/features/questions/questions.types.js';
import {
  answerQuestionFactory,
  dismissQuestionFactory,
  registerQuestionFactory,
  resolveQuestionFactory,
} from '../src/features/questions/usecases/index.js';
import { attachWebSocket, type WsHub } from '../src/shared/ws/index.js';
import {
  buildAllowOutput,
  buildAskBody,
  buildResolvedBody,
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
}

const harness = (timeoutMs?: number): Harness => {
  const store: QuestionStore = createQuestionStore();
  const sent: ServerMessage[] = [];
  const broadcast: Broadcast = (message: ServerMessage): void => {
    sent.push(message);
  };
  let n = 0;
  return {
    store,
    sent,
    usecases: {
      registerQuestion: registerQuestionFactory({
        store,
        broadcast,
        timeoutMs,
        newUuid: (): string => `prompt-${++n}`,
      }),
      answerQuestion: answerQuestionFactory({ store }),
      dismissQuestion: dismissQuestionFactory({ store }),
      resolveQuestion: resolveQuestionFactory({ store }),
      listPending: store.list,
    },
  };
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

  it('an abort (the hook went away) resolves as terminal; a second settle is a no-op', async () => {
    const h: Harness = harness();
    const gone: AbortController = new AbortController();
    const waiting = h.usecases.registerQuestion(ASK, gone.signal);
    gone.abort();
    expect(await waiting).toEqual({ action: 'dismiss' });
    expect(
      h.sent.filter((m: ServerMessage): boolean => m.type === 'session.question.resolved'),
    ).toEqual([
      {
        type: 'session.question.resolved',
        sessionId: ASK.sessionId,
        promptId: 'prompt-1',
        reason: 'terminal',
      },
    ]);
    expect(h.usecases.dismissQuestion({ sessionId: ASK.sessionId, promptId: 'prompt-1' })).toEqual({
      ok: false,
      reason: 'not-found',
    });
  });

  it('times out into the terminal dialog', async () => {
    const h: Harness = harness(20);
    expect(await h.usecases.registerQuestion(ASK)).toEqual({ action: 'dismiss' });
    expect(h.sent[1]).toMatchObject({ reason: 'timeout' });
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
      broadcast: (message: ServerMessage): void => {
        sent.push(message);
      },
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
      broadcast: (message: ServerMessage): void => {
        sent.push(message);
      },
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

  it('a hook that disconnects clears the question as terminal', async () => {
    const abort: AbortController = new AbortController();
    const poll: Promise<Response> = post('/hooks/ask-user-question', ASK, abort.signal);
    poll.catch((): void => {});
    await pendingId();
    abort.abort();
    for (let i = 0; i < 100 && store.list().length > 0; i++) {
      await new Promise((r): void => void setTimeout(r, 10));
    }
    expect(store.list()).toEqual([]);
    expect(sent.at(-1)).toMatchObject({ type: 'session.question.resolved', reason: 'terminal' });
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
    const usecases: QuestionUsecases = {
      registerQuestion: registerQuestionFactory({ store, broadcast: (m): void => broadcast(m) }),
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

    beforeAll(async () => {
      server = createServer((req, res): void => {
        const parts: Buffer[] = [];
        req.on('data', (p: Buffer): void => void parts.push(p));
        req.on('end', (): void => {
          received = {
            url: req.url,
            key: req.headers['x-api-key'],
            body: JSON.parse(Buffer.concat(parts).toString()),
          };
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(reply));
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

    it('prints nothing on dismiss, with no studio env, or when the API is unreachable', async () => {
      reply = { action: 'dismiss' };
      expect(await run(event, { STUDIO_SESSION_ID: 's', STUDIO_API_URL: origin })).toBe('');
      expect(await run(event, {})).toBe('');
      expect(
        await run(event, { STUDIO_SESSION_ID: 's', STUDIO_API_URL: 'http://127.0.0.1:1' }),
      ).toBe('');
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
  });
});
