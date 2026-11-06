import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unwrapPastedContent } from '../src/features/chat/chat.utils.js';
import type { ServerMessage } from '../src/features/questions/questions.types.js';
import { createQuestionStore } from '../src/features/questions/index.js';
import type { QuestionStore } from '../src/features/questions/questions.types.js';
import { refusalError } from '../src/features/sessions/controllers/send-message.controller.js';
import { listSessionsFactory } from '../src/features/sessions/services/list-sessions.service.js';
import type { FactorySession, SendMessageResult } from '../src/features/sessions/sessions.types.js';
import { acceptsMessage } from '../src/features/sessions/sessions.utils.js';
import { sendMessageFactory } from '../src/features/sessions/usecases/send-message.usecase.js';
import { fakeHerdr, workspace, type FakeHerdr, type FakeWorkspace } from './helpers.js';
import { buildTestApp, listen, makeWorkDir, type Listening, type WorkDir } from './work-dir.js';

const IDLE = 'factory-canonical-00000001';
const WORKING = 'factory-research-00000002';
const DONE = 'factory-done-00000003';
const BLOCKED = 'factory-blocked-00000004';
const ASKING = 'factory-asking-00000005';

const CYRILLIC: string = `Строка один: продолжи.\nLine two with "quotes", $HOME and \`ticks\`.\n\nТретий абзац.`;

const build = (herdr: FakeHerdr, sent: ServerMessage[], asking: string[] = [ASKING]) =>
  sendMessageFactory({
    herdr: herdr.client,
    listSessions: listSessionsFactory({
      herdr: herdr.client,
      readMeta: async (): Promise<null> => null,
    }),
    hasPendingQuestion: (sessionId: string): boolean => asking.includes(sessionId),
    broadcast: (message: ServerMessage): void => void sent.push(message),
  });

const fleet = (): FakeHerdr =>
  fakeHerdr([
    workspace('w1', IDLE, 'idle'),
    workspace('w2', WORKING, 'working'),
    workspace('w3', DONE, 'done'),
    workspace('w4', BLOCKED, 'blocked'),
    workspace('w5', ASKING, 'working'),
    workspace('w6', 'viz', 'idle'),
  ]);

describe('acceptsMessage', () => {
  it('idle and done take a message; working, blocked, unknown and none do not', () => {
    expect(acceptsMessage('idle')).toBe(true);
    expect(acceptsMessage('done')).toBe(true);
    expect(acceptsMessage('working')).toBe(false);
    expect(acceptsMessage('blocked')).toBe(false);
    expect(acceptsMessage('unknown')).toBe(false);
    expect(acceptsMessage(undefined)).toBe(false);
  });
});

describe('unwrapPastedContent', () => {
  it('takes the inside of the paste wrapper and leaves plain text alone', () => {
    expect(
      unwrapPastedContent(`<pasted_content id="951c">\nраз\nдва\n</pasted_content id="951c">`),
    ).toBe('раз\nдва');
    expect(unwrapPastedContent('typed <pasted_content id="1">\na\n</pasted_content> after')).toBe(
      'typed a after',
    );
    // Claude Code puts blank lines before the wrapper; the bubble should not start with them.
    expect(unwrapPastedContent('\n\n<pasted_content id="2">\nраз\n</pasted_content id="2">')).toBe(
      'раз',
    );
    expect(unwrapPastedContent('plain words')).toBe('plain words');
  });
});

describe('sendMessage (usecase)', () => {
  it('prompts the pane of an idle session verbatim and says the session is working', async () => {
    const herdr: FakeHerdr = fleet();
    const sent: ServerMessage[] = [];
    const result: SendMessageResult = await build(herdr, sent)(IDLE, CYRILLIC);
    expect(result).toEqual({ ok: true, started: true });
    const target: FakeWorkspace | undefined = herdr.workspaces[0];
    expect(target?.prompts).toEqual([CYRILLIC]);
    expect(target?.texts).toEqual([]);
    expect(target?.keys).toEqual([]);
    expect(sent).toEqual([{ type: 'session.status', sessionId: IDLE, status: 'working' }]);
  });

  it('a done session takes a message too', async () => {
    const herdr: FakeHerdr = fleet();
    expect(await build(herdr, [])(DONE, 'go on')).toEqual({ ok: true, started: true });
    expect(herdr.workspaces[2]?.prompts).toEqual(['go on']);
  });

  it('refuses a working or blocked session with its status, and nothing reaches the pane', async () => {
    const herdr: FakeHerdr = fleet();
    const send = build(herdr, []);
    expect(await send(WORKING, 'hi')).toEqual({ ok: false, reason: 'not-idle', status: 'working' });
    expect(await send(BLOCKED, 'hi')).toEqual({ ok: false, reason: 'not-idle', status: 'blocked' });
    expect(herdr.workspaces.flatMap((w: FakeWorkspace): string[] => w.prompts)).toEqual([]);
  });

  it('refuses a session with a pending studio question before looking at its status', async () => {
    const herdr: FakeHerdr = fleet();
    herdr.workspaces[4]!.status = 'idle';
    expect(await build(herdr, [])(ASKING, 'hi')).toEqual({ ok: false, reason: 'question' });
  });

  it('an unknown name, or a workspace that is not a factory session, is not-found', async () => {
    const herdr: FakeHerdr = fleet();
    const send = build(herdr, []);
    expect(await send('factory-nope-00000009', 'hi')).toEqual({ ok: false, reason: 'not-found' });
    expect(await send('viz', 'hi')).toEqual({ ok: false, reason: 'not-found' });
  });

  it('a second send while the first is on its way is in-flight; the session frees after', async () => {
    const herdr: FakeHerdr = fleet();
    let release: () => void = (): void => {};
    const gate: Promise<void> = new Promise<void>((resolve): void => {
      release = resolve;
    });
    const paneIds: string[] = [];
    const slow = sendMessageFactory({
      herdr: {
        promptAgent: async (
          paneId: string,
        ): Promise<{ ok: true; started: true; status: 'working' }> => {
          paneIds.push(paneId);
          // Only the first submission hangs; the one to the other session answers at once.
          if (paneIds.length === 1) await gate;
          return { ok: true, started: true, status: 'working' };
        },
      },
      listSessions: listSessionsFactory({
        herdr: herdr.client,
        readMeta: async (): Promise<null> => null,
      }),
      hasPendingQuestion: (): boolean => false,
      broadcast: (): void => {},
    });
    const first: Promise<SendMessageResult> = slow(IDLE, 'one');
    await new Promise((r): void => void setTimeout(r, 5));
    expect(await slow(IDLE, 'two')).toEqual({ ok: false, reason: 'in-flight' });
    // Another session is not held up by this one.
    expect(await slow(DONE, 'three')).toEqual({ ok: true, started: true });
    release();
    expect(await first).toEqual({ ok: true, started: true });
  });

  it('a herdr refusal is passed on with its code; a stall is sent but not started', async () => {
    const herdr: FakeHerdr = fleet();
    const sent: ServerMessage[] = [];
    herdr.promptOutcome.value = { ok: false, code: 'agent_blocked', message: 'dialog open' };
    expect(await build(herdr, sent)(IDLE, 'hi')).toEqual({
      ok: false,
      reason: 'herdr',
      code: 'agent_blocked',
      message: 'dialog open',
    });
    herdr.promptOutcome.value = { ok: true, started: false, status: 'unknown' };
    expect(await build(herdr, sent)(IDLE, 'hi')).toEqual({ ok: true, started: false });
    expect(sent).toEqual([]);
  });
});

describe('refusalError', () => {
  it('maps every refusal to a status and a reason the app can read', () => {
    expect(refusalError({ ok: false, reason: 'not-found' })).toMatchObject({ status: 404 });
    expect(refusalError({ ok: false, reason: 'in-flight' })).toMatchObject({
      status: 409,
      details: { reason: 'in-flight' },
    });
    expect(refusalError({ ok: false, reason: 'question' })).toMatchObject({ status: 409 });
    expect(refusalError({ ok: false, reason: 'not-idle', status: 'working' })).toMatchObject({
      status: 409,
      details: { reason: 'not-idle', status: 'working' },
    });
    expect(
      refusalError({ ok: false, reason: 'herdr', code: 'agent_blocked', message: 'x' }),
    ).toMatchObject({ status: 409, details: { code: 'agent_blocked' } });
    expect(
      refusalError({ ok: false, reason: 'herdr', code: 'server_not_running', message: 'x' }),
    ).toMatchObject({ status: 502 });
  });
});

describe('POST /api/v1/sessions/:sessionId/messages', () => {
  let work: WorkDir;
  let herdr: FakeHerdr;
  let api: Listening;
  let base: string;
  const sent: ServerMessage[] = [];
  const store: QuestionStore = createQuestionStore();

  beforeAll(async () => {
    work = await makeWorkDir();
    herdr = fleet();
    api = await listen(
      buildTestApp(work, herdr.client, {
        questionStore: store,
        broadcast: (message: ServerMessage): void => void sent.push(message),
      }),
    );
    base = `${api.origin}/api/v1`;
  });
  afterAll(async () => {
    await api.close();
    await work.cleanup();
  });

  const post = (session: string, body: unknown): Promise<Response> =>
    fetch(`${base}/sessions/${encodeURIComponent(session)}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('202 with the text delivered whole, and a working status broadcast', async () => {
    const res: Response = await post(IDLE, { text: CYRILLIC });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, sessionId: IDLE, started: true });
    expect(herdr.workspaces[0]?.prompts).toEqual([CYRILLIC]);
    expect(sent).toContainEqual({ type: 'session.status', sessionId: IDLE, status: 'working' });
  });

  it('409 once the session works (the fake turned it working), with the reason in details', async () => {
    const res: Response = await post(IDLE, { text: 'again' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining('working'),
      details: { reason: 'not-idle', status: 'working' },
    });
    expect(herdr.workspaces[0]?.prompts).toEqual([CYRILLIC]);
  });

  it('404 for a session herdr does not have', async () => {
    expect((await post('factory-gone-00000009', { text: 'hi' })).status).toBe(404);
  });

  it('400 for a blank text, a missing text, or a session name that is not one', async () => {
    expect((await post(DONE, { text: '   \n' })).status).toBe(400);
    expect((await post(DONE, {})).status).toBe(400);
    expect((await post('Not A Session', { text: 'hi' })).status).toBe(400);
    expect(herdr.workspaces[2]?.prompts).toEqual([]);
  });

  it('GET /sessions still lists the session (the route sits beside the others)', async () => {
    const res: Response = await fetch(`${base}/sessions`);
    const body = (await res.json()) as { sessions: FactorySession[] };
    expect(body.sessions.some((s: FactorySession): boolean => s.session === IDLE)).toBe(true);
  });
});
