import { appendFile, copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFsClient } from '../src/clients/fs/fs.client.js';
import { createTranscriptClient } from '../src/clients/transcript/transcript.client.js';
import type { TranscriptClient } from '../src/clients/transcript/transcript.types.js';
import type {
  ChatHub,
  ChatItem,
  ChatServerMessage,
  TranscriptTailer,
} from '../src/features/chat/chat.types.js';
import {
  createTailerFactory,
  readTranscriptLinkFactory,
  recordTranscriptLinkFactory,
  resolveTranscriptFactory,
} from '../src/features/chat/index.js';
import type { WsClient } from '../src/shared/ws/ws.types.js';
import { fakeHerdr, workspace, type FakeHerdr } from './helpers.js';
import { buildTestApp, listen, makeWorkDir, type Listening, type WorkDir } from './work-dir.js';

const FIXTURES: string = path.join(import.meta.dirname, 'fixtures', 'transcript');
const CLAUDE_ID = '11111111-2222-3333-4444-555555555555';
const SESSION = 'factory-ask-questions-test-1a2b3c4d';
const AGENT = 'a27458932f1ad0ea7';

const until = async (check: () => boolean, ms = 3000): Promise<void> => {
  const end: number = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

/** The fixture laid out as Claude Code lays out a session: main file, subagents beside it. */
const layOut = async (work: WorkDir, cwd: string): Promise<string> => {
  const dir: string = path.join(work.projectsDir, cwd.replace(/[^A-Za-z0-9]/g, '-'));
  const main: string = path.join(dir, `${CLAUDE_ID}.jsonl`);
  const subagents: string = path.join(dir, CLAUDE_ID, 'subagents');
  await mkdir(subagents, { recursive: true });
  await copyFile(path.join(FIXTURES, 'session.jsonl'), main);
  for (const ext of ['jsonl', 'meta.json']) {
    await copyFile(
      path.join(FIXTURES, 'session', 'subagents', `agent-${AGENT}.${ext}`),
      path.join(subagents, `agent-${AGENT}.${ext}`),
    );
  }
  return main;
};

const line = (record: Record<string, unknown>): string => `${JSON.stringify(record)}\n`;

const assistantLine = (uuid: string, text: string): string =>
  line({
    type: 'assistant',
    uuid,
    timestamp: '2026-10-23T12:00:00.000Z',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  });

/** A socket stand-in that keeps what it was sent. */
const fakeClient = (id: string): WsClient & { got: ChatServerMessage[] } => {
  const got: ChatServerMessage[] = [];
  return { id, got, send: (message: unknown): void => void got.push(message as ChatServerMessage) };
};

describe('transcript tailer', () => {
  let work: WorkDir;
  const client: TranscriptClient = createTranscriptClient();

  beforeEach(async () => {
    work = await makeWorkDir();
  });
  afterEach(async () => {
    await work.cleanup();
  });

  it('reads the backlog of main and subagent files, then only what is appended', async () => {
    const main: string = await layOut(work, '/work');
    const live: ChatItem[] = [];
    const tailer: TranscriptTailer = createTailerFactory({ client, intervalMs: 10_000 })(
      { claudeSessionId: CLAUDE_ID, path: main },
      (items: ChatItem[]): void => void live.push(...items),
    );
    await tailer.start();
    const backlog: ChatItem[] = tailer.snapshot(10_000).items;
    expect(backlog.length).toBeGreaterThan(30);
    // The subagent opens with a row under the Agent call that started it.
    const opening: ChatItem | undefined = backlog.find(
      (item: ChatItem): boolean => item.kind === 'subagent',
    );
    expect(opening).toMatchObject({
      text: 'Record all answers',
      tool: 'general-purpose',
      agentId: AGENT,
      parentToolUseId: 'toolu_016TcDHUWVruNncmbTUZThfU',
    });
    expect(
      backlog.filter((item: ChatItem): boolean => item.agentId === AGENT).length,
    ).toBeGreaterThan(5);

    // Half a line is held back until its newline arrives.
    const next: string = assistantLine('new-1', 'Appended live');
    await appendFile(main, next.slice(0, 20));
    await tailer.poll();
    expect(live).toEqual([]);
    await appendFile(main, next.slice(20));
    await tailer.poll();
    expect(live.map((item: ChatItem): string => item.text)).toEqual(['Appended live']);
    tailer.stop();
  });

  it('starts a long file near its end, and still opens each subagent with its row', async () => {
    const main: string = await layOut(work, '/work');
    const tailer: TranscriptTailer = createTailerFactory({
      client,
      backlogBytes: { main: 3000, subagent: 2000 },
    })({ claudeSessionId: CLAUDE_ID, path: main }, (): void => {});
    await tailer.start();
    tailer.stop();
    const items: ChatItem[] = tailer.snapshot(10_000).items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(20);
    expect(items.some((item: ChatItem): boolean => item.kind === 'subagent')).toBe(true);
    // Merged by time: never a step back.
    const stamps: string[] = items.map((item: ChatItem): string => item.ts);
    expect([...stamps].sort()).toEqual(stamps);
  });

  it('keeps only the newest items and counts the rest', async () => {
    const main: string = await layOut(work, '/work');
    const tailer: TranscriptTailer = createTailerFactory({ client, cap: 10 })(
      { claudeSessionId: CLAUDE_ID, path: main },
      (): void => {},
    );
    await tailer.start();
    tailer.stop();
    const snapshot = tailer.snapshot(4);
    expect(snapshot.items).toHaveLength(4);
    expect(snapshot.dropped).toBeGreaterThan(20);
  });
});

describe('transcript link', () => {
  let work: WorkDir;
  let herdr: FakeHerdr;

  beforeEach(async () => {
    work = await makeWorkDir();
    herdr = fakeHerdr([workspace('w1', SESSION, 'working')]);
  });
  afterEach(async () => {
    await work.cleanup();
  });

  it('prefers what the SessionStart hook recorded, refuses paths outside the projects folder', async () => {
    const main: string = await layOut(work, '/elsewhere');
    const settings = {
      fs: createFsClient({}),
      promptDir: work.promptDir,
      projectsDir: work.projectsDir,
    };
    const record = recordTranscriptLinkFactory(settings);
    expect(
      await record({
        sessionId: SESSION,
        claudeSessionId: CLAUDE_ID,
        transcriptPath: '/etc/x.jsonl',
      }),
    ).toBe(false);
    expect(
      await record({ sessionId: '../x', claudeSessionId: CLAUDE_ID, transcriptPath: main }),
    ).toBe(false);
    expect(
      await record({ sessionId: SESSION, claudeSessionId: CLAUDE_ID, transcriptPath: main }),
    ).toBe(true);
    const resolve = resolveTranscriptFactory({
      readLink: readTranscriptLinkFactory(settings),
      herdr: herdr.client,
      transcripts: createTranscriptClient(),
      projectsDir: work.projectsDir,
      workDir: work.dir,
    });
    expect(await resolve(SESSION)).toEqual({
      ok: true,
      transcript: { claudeSessionId: CLAUDE_ID, path: main },
    });
    expect(await resolve('factory-gone-00000000')).toEqual({
      ok: false,
      reason: 'unknown-session',
    });
  });

  it('falls back to the session id herdr saw in the pane', async () => {
    const settings = {
      fs: createFsClient({}),
      promptDir: work.promptDir,
      projectsDir: work.projectsDir,
    };
    const resolve = resolveTranscriptFactory({
      readLink: readTranscriptLinkFactory(settings),
      herdr: herdr.client,
      transcripts: createTranscriptClient(),
      projectsDir: work.projectsDir,
      workDir: work.dir,
    });
    expect(await resolve(SESSION)).toEqual({ ok: false, reason: 'no-transcript' });
    const main: string = await layOut(work, '/work');
    herdr.workspaces[0]!.agentSessionId = CLAUDE_ID;
    expect(await resolve(SESSION)).toEqual({
      ok: true,
      transcript: { claudeSessionId: CLAUDE_ID, path: main },
    });
  });
});

describe('chat hub and routes', () => {
  let work: WorkDir;
  let herdr: FakeHerdr;
  let hub: ChatHub;
  let server: Listening;

  beforeEach(async () => {
    work = await makeWorkDir();
    herdr = fakeHerdr([workspace('w1', SESSION, 'working')]);
    server = await listen(
      buildTestApp(work, herdr.client, {
        webDist: null,
        onChatHub: (created: ChatHub): void => {
          hub = created;
        },
      }),
    );
  });
  afterEach(async () => {
    hub.close();
    await server.close();
    await work.cleanup();
  });

  const post = (route: string, body: unknown): Promise<Response> =>
    fetch(`${server.origin}/api/v1${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('says "no transcript" until the hook reports one, then sends a backlog and live items', async () => {
    const viewer = fakeClient('c1');
    await hub.subscribe(SESSION, viewer);
    expect(viewer.got).toEqual([
      { type: 'session.chat.unavailable', sessionId: SESSION, reason: 'no-transcript' },
    ]);

    const main: string = await layOut(work, '/work');
    const hooked: Response = await post('/hooks/session-start', {
      sessionId: SESSION,
      claudeSessionId: CLAUDE_ID,
      transcriptPath: main,
      source: 'startup',
    });
    expect(await hooked.json()).toEqual({ ok: true });
    const backlog = viewer.got[1];
    expect(backlog).toMatchObject({ type: 'session.chat.backlog', claudeSessionId: CLAUDE_ID });
    expect(backlog?.type === 'session.chat.backlog' && backlog.items.length).toBeGreaterThan(30);

    await appendFile(main, assistantLine('live-1', 'Live words'));
    await until((): boolean => viewer.got.length > 2);
    expect(viewer.got[2]).toMatchObject({
      type: 'session.chat.items',
      items: [expect.objectContaining({ kind: 'assistant', text: 'Live words' })],
    });

    // A second viewer gets the same backlog, now with the live line in it.
    const second = fakeClient('c2');
    await hub.subscribe(SESSION, second);
    const again = second.got[0];
    expect(again?.type === 'session.chat.backlog' && again.items.at(-1)?.text).toBe('Live words');

    // The session goes away: one last read, then "ended", and the watch is dropped.
    await hub.reconcile([]);
    expect(viewer.got.at(-1)).toEqual({ type: 'session.chat.ended', sessionId: SESSION });
    expect(second.got.at(-1)).toEqual({ type: 'session.chat.ended', sessionId: SESSION });
  });

  it('answers the history over REST and an item uncut by its ref', async () => {
    const main: string = await layOut(work, '/work');
    const long: string = 'y'.repeat(30_000);
    await appendFile(main, assistantLine('long-1', long));
    await post('/hooks/session-start', {
      sessionId: SESSION,
      claudeSessionId: CLAUDE_ID,
      transcriptPath: main,
    });
    const res: Response = await fetch(`${server.origin}/api/v1/sessions/${SESSION}/chat?limit=5`);
    expect(res.status).toBe(200);
    const history = (await res.json()) as { items: ChatItem[]; dropped: number };
    expect(history.items).toHaveLength(5);
    expect(history.dropped).toBeGreaterThan(20);
    const cut: ChatItem | undefined = history.items.at(-1);
    expect(cut?.ref).toMatch(/^main:\d+:\d+$/);
    expect(cut?.text.length).toBeLessThan(13_000);

    const full: Response = await fetch(
      `${server.origin}/api/v1/sessions/${SESSION}/chat/items/${encodeURIComponent(cut!.id)}?ref=${cut!.ref}`,
    );
    expect(((await full.json()) as { item: ChatItem }).item.text).toBe(long);

    const bad: Response = await fetch(
      `${server.origin}/api/v1/sessions/${SESSION}/chat/items/x?ref=main:0:5`,
    );
    expect(bad.status).toBe(404);
    const unknown: Response = await fetch(`${server.origin}/api/v1/sessions/nope/chat`);
    expect(unknown.status).toBe(404);
  });

  it('writes the link file private and keeps it for a restarted API', async () => {
    const main: string = await layOut(work, '/work');
    await post('/hooks/session-start', {
      sessionId: SESSION,
      claudeSessionId: CLAUDE_ID,
      transcriptPath: main,
    });
    const saved: unknown = JSON.parse(
      await readFile(path.join(work.promptDir, `${SESSION}.transcript.json`), 'utf8'),
    );
    expect(saved).toMatchObject({ claudeSessionId: CLAUDE_ID, transcriptPath: main });
    // GET /sessions reports Claude's session id from the link.
    const listed = (await (await fetch(`${server.origin}/api/v1/sessions`)).json()) as {
      sessions: { claudeSessionId?: string }[];
    };
    expect(listed.sessions[0]?.claudeSessionId).toBe(CLAUDE_ID);
  });

  it('refuses a session-start body that is not one', async () => {
    const res: Response = await post('/hooks/session-start', { sessionId: SESSION });
    expect(res.status).toBe(400);
  });
});
