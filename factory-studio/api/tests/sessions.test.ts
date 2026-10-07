import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFsClient } from '../src/clients/fs/fs.client.js';
import { listSessionsFactory } from '../src/features/sessions/services/list-sessions.service.js';
import { startSessionFactory } from '../src/features/sessions/services/start-session.service.js';
import { stopSessionFactory } from '../src/features/sessions/services/stop-session.service.js';
import { writePromptFileFactory } from '../src/features/sessions/services/write-prompt-file.service.js';
import { startFactorySessionFactory } from '../src/features/sessions/usecases/start-factory-session.usecase.js';
import type {
  FactorySession,
  StartFactoryResult,
  StopSessionResult,
} from '../src/features/sessions/sessions.types.js';
import { fakeTmux, session, type FakeSession, type FakeTmux } from './helpers.js';
import { buildTestApp, listen, makeWorkDir, type Listening, type WorkDir } from './work-dir.js';

const UUID = '7f3a9c2b-0000-0000-0000-000000000000';

describe('startFactorySession (usecase)', () => {
  let work: WorkDir;
  let tmux: FakeTmux;

  beforeEach(async () => {
    work = await makeWorkDir();
    tmux = fakeTmux();
  });
  afterEach(async () => {
    await work.cleanup();
  });

  const build = (newUuid: () => string = (): string => UUID) =>
    startFactorySessionFactory({
      workDir: '/work',
      listFactorySkills: async (): Promise<string[]> => ['canonical-factory', 'research-factory'],
      writePromptFile: writePromptFileFactory({
        fs: createFsClient({}),
        promptDir: work.promptDir,
      }),
      startSession: startSessionFactory({ tmux: tmux.client, graceMs: 0 }),
      newUuid,
    });

  it('starts a session with the prompt on disk (0600 in 0700) and the command reading it', async () => {
    const result: StartFactoryResult = await build()({
      id: 'research-factory',
      prompt: `AI dark factories; "quotes" and $(rm -rf /) stay text`,
      harness: 'claude',
    });
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);

    expect(result.run.session).toBe('factory-research-7f3a9c2b');
    expect(result.run.prompt).toBe(
      `/research-factory AI dark factories; "quotes" and $(rm -rf /) stay text`,
    );
    expect(result.run.promptFile).toBe(
      path.join(work.promptDir, 'factory-research-7f3a9c2b.prompt'),
    );
    expect(await readFile(result.run.promptFile, 'utf8')).toBe(result.run.prompt);
    expect((await stat(result.run.promptFile)).mode & 0o777).toBe(0o600);
    expect((await stat(work.promptDir)).mode & 0o777).toBe(0o700);

    const started: FakeSession | undefined = tmux.sessions[0];
    expect(started?.cwd).toBe('/work');
    expect(started?.labels).toEqual({ harness: 'claude', factory_id: 'research-factory' });
    expect(started?.command).toBe(
      `claude --dangerously-skip-permissions --disallowedTools=AskUserQuestion,EnterPlanMode,ExitPlanMode --append-system-prompt 'You run unattended: nobody will answer questions. Never ask the user anything and never wait for confirmation; make the most reasonable decision, note the assumption, and carry on to the end.' "$(cat '${result.run.promptFile}')"`,
    );
    expect(started?.command).not.toContain('rm -rf');
  });

  it('refuses an id that is not a skill on disk, naming the ones that are', async () => {
    const result: StartFactoryResult = await build()({
      id: 'typo-factory',
      prompt: 'x',
      harness: 'claude',
    });
    expect(result).toEqual({
      ok: false,
      reason: 'unknown-factory',
      available: ['canonical-factory', 'research-factory'],
    });
    expect(tmux.sessions).toEqual([]);
  });

  it('reports a session that died inside the grace period', async () => {
    tmux.dieOnStart.add('factory-canonical-7f3a9c2b');
    const result: StartFactoryResult = await build()({
      id: 'canonical-factory',
      prompt: 'ST-1',
      harness: 'codex',
    });
    expect(result).toEqual({
      ok: false,
      reason: 'exited-immediately',
      session: 'factory-canonical-7f3a9c2b',
      harness: 'codex',
    });
  });

  it('starts the same factory twice without complaint', async () => {
    const uuids: string[] = [
      '11111111-0000-0000-0000-000000000000',
      '22222222-0000-0000-0000-000000000000',
    ];
    const start = build((): string => uuids.shift() ?? '');
    const first: StartFactoryResult = await start({
      id: 'research-factory',
      prompt: 'a',
      harness: 'claude',
    });
    const second: StartFactoryResult = await start({
      id: 'research-factory',
      prompt: 'b',
      harness: 'claude',
    });
    expect(first.ok && second.ok).toBe(true);
    expect(tmux.sessions.map((s: FakeSession): string => s.name)).toEqual([
      'factory-research-11111111',
      'factory-research-22222222',
    ]);
  });
});

describe('stopSession (service)', () => {
  const build = (tmux: FakeTmux) => {
    const listSessions = listSessionsFactory({ tmux: tmux.client });
    return stopSessionFactory({ tmux: tmux.client, listSessions });
  };

  it('stops by full session name', async () => {
    const tmux: FakeTmux = fakeTmux([
      session('factory-research-aaaaaaaa', 'research-factory', 'copilot'),
      session('factory-research-bbbbbbbb', 'research-factory', 'claude'),
    ]);
    const result: StopSessionResult = await build(tmux)('factory-research-bbbbbbbb');
    expect(result.ok).toBe(true);
    expect(tmux.killed).toEqual(['factory-research-bbbbbbbb']);
  });

  it('stops by factory id when exactly one session has it', async () => {
    const tmux: FakeTmux = fakeTmux([
      session('factory-research-aaaaaaaa', 'research-factory', 'copilot'),
      session('factory-canonical-cccccccc', 'canonical-factory', 'copilot'),
    ]);
    const result: StopSessionResult = await build(tmux)('canonical-factory');
    expect(result.ok && result.stopped.session).toBe('factory-canonical-cccccccc');
    expect(tmux.killed).toEqual(['factory-canonical-cccccccc']);
  });

  it('refuses an ambiguous id with the candidates, and kills nothing', async () => {
    const tmux: FakeTmux = fakeTmux([
      session('factory-research-aaaaaaaa', 'research-factory', 'copilot'),
      session('factory-research-bbbbbbbb', 'research-factory', 'claude'),
    ]);
    const result: StopSessionResult = await build(tmux)('research-factory');
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== 'ambiguous') throw new Error('expected ambiguous');
    expect(result.sessions.map((s: FactorySession): string => s.session)).toEqual([
      'factory-research-aaaaaaaa',
      'factory-research-bbbbbbbb',
    ]);
    expect(tmux.killed).toEqual([]);
  });

  it('reports not-found with what is running', async () => {
    const tmux: FakeTmux = fakeTmux([
      session('factory-research-aaaaaaaa', 'research-factory', 'copilot'),
    ]);
    const result: StopSessionResult = await build(tmux)('nope-factory');
    expect(result).toEqual({
      ok: false,
      reason: 'not-found',
      running: ['factory-research-aaaaaaaa'],
    });
  });

  it('ignores sessions that are not factory sessions', async () => {
    const tmux: FakeTmux = fakeTmux([session('viz', '', '')]);
    const result: StopSessionResult = await build(tmux)('viz');
    expect(result.ok).toBe(false);
    expect(tmux.killed).toEqual([]);
  });
});

describe('/api/v1/sessions over HTTP', () => {
  let work: WorkDir;
  let tmux: FakeTmux;
  let api: Listening;
  let base: string;
  const uuids: string[] = [];

  beforeAll(async () => {
    work = await makeWorkDir();
    tmux = fakeTmux([
      session('factory-canonical-00000001', 'canonical-factory', 'claude', 600),
      session('factory-byhand-00000002', '', '', 60),
      session('viz', '', '', 3000),
    ]);
    api = await listen(
      buildTestApp(work, tmux.client, { newUuid: (): string => uuids.shift() ?? UUID }),
    );
    base = `${api.origin}/api/v1`;
  });
  afterAll(async () => {
    await api.close();
    await work.cleanup();
  });

  const post = (path: string, body: unknown): Promise<Response> =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('GET lists factory sessions oldest first, unknown harness for an unlabelled one', async () => {
    const res: Response = await fetch(`${base}/sessions`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { count: number; sessions: FactorySession[] };
    expect(body.count).toBe(2);
    expect(body.sessions.map((s: FactorySession): string => s.session)).toEqual([
      'factory-canonical-00000001',
      'factory-byhand-00000002',
    ]);
    expect(body.sessions[0]).toMatchObject({
      factoryId: 'canonical-factory',
      harness: 'claude',
      age: '10m',
    });
    expect(body.sessions[1]).toMatchObject({ factoryId: 'byhand-factory', harness: 'unknown' });
  });

  it('POST 201 with harness claude by default and the prompt file written', async () => {
    uuids.push('aaaaaaaa-0000-0000-0000-000000000000');
    const res: Response = await post('/sessions', {
      id: 'canonical-factory',
      prompt: '$(touch /tmp/pwned); echo hi',
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as {
      session: string;
      harness: string;
      prompt: string;
      promptFile: string;
      workDir: string;
      factoryId: string;
    };
    expect(body).toMatchObject({
      session: 'factory-canonical-aaaaaaaa',
      factoryId: 'canonical-factory',
      harness: 'claude',
      prompt: '/canonical-factory $(touch /tmp/pwned); echo hi',
      workDir: work.dir,
    });
    expect(await readFile(body.promptFile, 'utf8')).toBe(
      '/canonical-factory $(touch /tmp/pwned); echo hi',
    );
    expect((await stat(body.promptFile)).mode & 0o777).toBe(0o600);
    const started: FakeSession | undefined = tmux.sessions.find(
      (s: FakeSession): boolean => s.name === body.session,
    );
    expect(started?.cwd).toBe(work.dir);
    expect(started?.command).not.toContain('pwned');
  });

  it('POST 400 on an id without -factory, an empty prompt, an unknown harness', async () => {
    for (const body of [
      { id: 'canonical', prompt: 'x' },
      { id: 'canonical-factory', prompt: '   ' },
      { id: 'canonical-factory', prompt: 'x', harness: 'gemini' },
    ]) {
      const res: Response = await post('/sessions', body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid request body' });
    }
  });

  it('POST 404 listing the pipeline skills for create-any-factory', async () => {
    const res: Response = await post('/sessions', { id: 'create-any-factory', prompt: 'x' });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: 'no such factory skill on disk',
      details: { available: ['canonical-factory', 'local-factory', 'other-factory'] },
    });
  });

  it('POST 404 for a listed pipeline without its wrapper skill', async () => {
    const res: Response = await post('/sessions', { id: 'unwrapped-factory', prompt: 'x' });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      details: { available: ['canonical-factory', 'local-factory', 'other-factory'] },
    });
  });

  it('POST 502 naming the harness when the session dies in the grace period', async () => {
    uuids.push('deaddead-0000-0000-0000-000000000000');
    tmux.dieOnStart.add('factory-other-deaddead');
    const res: Response = await post('/sessions', { id: 'other-factory', prompt: 'x' });
    expect(res.status).toBe(502);
    const body = (await res.json()) as {
      error: string;
      details: { session: string; harness: string };
    };
    expect(body.error).toContain('claude');
    expect(body.details).toEqual({ session: 'factory-other-deaddead', harness: 'claude' });
  });

  it('stop by an ambiguous id is 409 with the sessions, by name 200, unknown 404 with running', async () => {
    const ambiguous: Response = await post('/sessions/stop', { session: 'canonical-factory' });
    expect(ambiguous.status).toBe(409);
    const conflict = (await ambiguous.json()) as { details: { sessions: FactorySession[] } };
    expect(conflict.details.sessions.map((s: FactorySession): string => s.session)).toEqual([
      'factory-canonical-00000001',
      'factory-canonical-aaaaaaaa',
    ]);

    const byName: Response = await post('/sessions/stop', {
      session: 'factory-canonical-aaaaaaaa',
    });
    expect(byName.status).toBe(200);
    expect(await byName.json()).toMatchObject({
      stopped: { session: 'factory-canonical-aaaaaaaa' },
    });
    expect(tmux.killed).toEqual(['factory-canonical-aaaaaaaa']);

    const byId: Response = await post('/sessions/stop', { session: 'canonical' });
    expect(byId.status).toBe(200);

    const unknown: Response = await post('/sessions/stop', { session: 'canonical-factory' });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({
      details: { running: ['factory-byhand-00000002'] },
    });

    const notOurs: Response = await post('/sessions/stop', { session: 'viz' });
    expect(notOurs.status).toBe(404);
    expect(tmux.sessions.some((s: FakeSession): boolean => s.name === 'viz')).toBe(true);
  });
});
