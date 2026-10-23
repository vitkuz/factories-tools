import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFsClient } from '../src/clients/fs/fs.client.js';
import { listSessionsFactory } from '../src/features/sessions/services/list-sessions.service.js';
import {
  readSessionMetaFactory,
  writeSessionMetaFactory,
} from '../src/features/sessions/services/session-meta.service.js';
import { writeHookSettingsFactory } from '../src/features/sessions/services/write-hook-settings.service.js';
import { startSessionFactory } from '../src/features/sessions/services/start-session.service.js';
import { stopSessionFactory } from '../src/features/sessions/services/stop-session.service.js';
import { writePromptFileFactory } from '../src/features/sessions/services/write-prompt-file.service.js';
import { startFactorySessionFactory } from '../src/features/sessions/usecases/start-factory-session.usecase.js';
import type { FactoryParam } from '../src/features/pipelines/pipelines.types.js';
import type {
  FactorySession,
  StartFactoryResult,
  StopSessionResult,
} from '../src/features/sessions/sessions.types.js';
import { buildSessionMeta } from '../src/features/sessions/sessions.utils.js';
import { fakeHerdr, workspace, type FakeHerdr, type FakeWorkspace } from './helpers.js';
import { buildTestApp, listen, makeWorkDir, type Listening, type WorkDir } from './work-dir.js';

const UUID = '7f3a9c2b-0000-0000-0000-000000000000';
const CLAUDE_FLAGS: string = `--disallowedTools=EnterPlanMode,ExitPlanMode --append-system-prompt 'You run inside Factory Studio and may run unattended. Prefer the most reasonable decision: note the assumption and carry on to the end. Use AskUserQuestion only when a decision truly cannot be made without the person; the question is shown in the studio app, so ask clearly, once, and wait for the answer.'`;

const RESEARCH_PARAMS: FactoryParam[] = [
  { name: 'topic', type: 'string', default: '', required: true, main: true },
  { name: 'sub_questions', type: 'number', default: 5, required: false, main: false },
];

describe('startFactorySession (usecase)', () => {
  let work: WorkDir;
  let herdr: FakeHerdr;

  beforeEach(async () => {
    work = await makeWorkDir();
    herdr = fakeHerdr();
  });
  afterEach(async () => {
    await work.cleanup();
  });

  const build = (newUuid: () => string = (): string => UUID) =>
    startFactorySessionFactory({
      workDir: '/work',
      listFactorySkills: async (): Promise<string[]> => ['canonical-factory', 'research-factory'],
      readFactoryParams: async (id: string): Promise<FactoryParam[] | null> =>
        id === 'research-factory' ? RESEARCH_PARAMS : [],
      writePromptFile: writePromptFileFactory({
        fs: createFsClient({}),
        promptDir: work.promptDir,
      }),
      writeHookSettings: writeHookSettingsFactory({
        fs: createFsClient({}),
        promptDir: work.promptDir,
        nodePath: '/usr/bin/node',
        hookScript: '/opt/studio/hooks/hook.mjs',
      }),
      writeSessionMeta: writeSessionMetaFactory({
        fs: createFsClient({}),
        promptDir: work.promptDir,
      }),
      hookEnv: { STUDIO_API_URL: 'http://127.0.0.1:3100', STUDIO_API_KEY: 'k'.repeat(16) },
      startSession: startSessionFactory({ herdr: herdr.client, graceMs: 0 }),
      newUuid,
    });

  it('starts a session with the prompt on disk (0600 in 0700) and the command reading it', async () => {
    const result: StartFactoryResult = await build()({
      id: 'research-factory',
      prompt: `AI dark factories; "quotes" and $(rm -rf /) stay text`,
      params: {},
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

    const started: FakeWorkspace | undefined = herdr.workspaces[0];
    expect(started?.cwd).toBe('/work');
    expect(started?.label).toBe('factory-research-7f3a9c2b');
    expect(started?.env).toEqual({
      STUDIO_API_URL: 'http://127.0.0.1:3100',
      STUDIO_API_KEY: 'k'.repeat(16),
      STUDIO_SESSION_ID: 'factory-research-7f3a9c2b',
    });
    const settingsFile: string = path.join(
      work.promptDir,
      'factory-research-7f3a9c2b.settings.json',
    );
    expect(started?.commands).toEqual([
      `exec claude --dangerously-skip-permissions --settings '${settingsFile}' ${CLAUDE_FLAGS} "$(cat '${result.run.promptFile}')"`,
    ]);
    expect(started?.commands[0]).not.toContain('rm -rf');
    expect(started?.commands[0]).not.toContain('AskUserQuestion,');

    const settings = JSON.parse(await readFile(settingsFile, 'utf8')) as {
      hooks: Record<string, { matcher: string; hooks: { command: string; timeout?: number }[] }[]>;
    };
    expect(settings.hooks.PreToolUse?.[0]).toMatchObject({
      matcher: 'AskUserQuestion',
      hooks: [{ type: 'command', timeout: 3600 }],
    });
    expect(settings.hooks.PreToolUse?.[0]?.hooks[0]?.command).toBe(
      `'/usr/bin/node' '/opt/studio/hooks/hook.mjs'`,
    );
    expect(settings.hooks.PostToolUse?.[0]?.matcher).toBe('AskUserQuestion');
    expect((await stat(settingsFile)).mode & 0o777).toBe(0o600);

    // The meta file is what lets a restarted API describe the session again.
    const meta = await readSessionMetaFactory({
      fs: createFsClient({}),
      promptDir: work.promptDir,
    })('factory-research-7f3a9c2b');
    expect(meta).toMatchObject({
      session: 'factory-research-7f3a9c2b',
      factoryId: 'research-factory',
      harness: 'claude',
    });
  });

  it('refuses an id that is not a skill on disk, naming the ones that are', async () => {
    const result: StartFactoryResult = await build()({
      id: 'typo-factory',
      prompt: 'x',
      params: {},
      harness: 'claude',
    });
    expect(result).toEqual({
      ok: false,
      reason: 'unknown-factory',
      available: ['canonical-factory', 'research-factory'],
    });
    expect(herdr.workspaces).toEqual([]);
  });

  it('reports a session that died inside the grace period', async () => {
    herdr.dieOnRun.add('factory-canonical-7f3a9c2b');
    const result: StartFactoryResult = await build()({
      id: 'canonical-factory',
      prompt: 'ST-1',
      params: {},
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
      params: {},
      harness: 'claude',
    });
    const second: StartFactoryResult = await start({
      id: 'research-factory',
      prompt: 'b',
      params: {},
      harness: 'claude',
    });
    expect(first.ok && second.ok).toBe(true);
    expect(herdr.workspaces.map((w: FakeWorkspace): string => w.label)).toEqual([
      'factory-research-11111111',
      'factory-research-22222222',
    ]);
  });

  it('starts with params: every declared one as name=value, quoted, extra instructions after', async () => {
    const result: StartFactoryResult = await build()({
      id: 'research-factory',
      params: { topic: `AI "dark" factories\nin 2026 — it's $(whoami)`, sub_questions: '3' },
      prompt: 'Keep it short.',
      harness: 'claude',
    });
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
    const expected: string =
      '/research-factory topic="AI \\"dark\\" factories\nin 2026 — it\'s \\$(whoami)" sub_questions=3' +
      '\n\nExtra instructions: Keep it short.';
    expect(result.run.prompt).toBe(expected);
    expect(await readFile(result.run.promptFile, 'utf8')).toBe(expected);
    expect(herdr.workspaces[0]?.commands[0]).not.toContain('whoami');
  });

  it('refuses params that do not fit the pipeline, and starts nothing', async () => {
    const result: StartFactoryResult = await build()({
      id: 'research-factory',
      params: { topic: '  ', sub_questions: 'many', depth: 2 },
      prompt: '',
      harness: 'claude',
    });
    expect(result).toEqual({
      ok: false,
      reason: 'invalid-params',
      issues: [
        { path: ['params', 'depth'], message: 'is not a param of this factory' },
        { path: ['params', 'topic'], message: 'is required' },
        { path: ['params', 'sub_questions'], message: '"many" is not a number' },
      ],
    });
    expect(herdr.workspaces).toEqual([]);
  });

  it('refuses an empty prompt with no params', async () => {
    const result: StartFactoryResult = await build()({
      id: 'canonical-factory',
      params: {},
      prompt: '',
      harness: 'claude',
    });
    expect(result).toMatchObject({ ok: false, reason: 'invalid-params' });
    expect(herdr.workspaces).toEqual([]);
  });
});

describe('stopSession (service)', () => {
  const build = (herdr: FakeHerdr) => {
    const listSessions = listSessionsFactory({
      herdr: herdr.client,
      readMeta: async (): Promise<null> => null,
    });
    return stopSessionFactory({ herdr: herdr.client, listSessions });
  };

  it('stops by full session name', async () => {
    const herdr: FakeHerdr = fakeHerdr([
      workspace('w1', 'factory-research-aaaaaaaa'),
      workspace('w2', 'factory-research-bbbbbbbb'),
    ]);
    const result: StopSessionResult = await build(herdr)('factory-research-bbbbbbbb');
    expect(result.ok).toBe(true);
    expect(herdr.closed).toEqual(['w2']);
  });

  it('stops by factory id when exactly one session has it', async () => {
    const herdr: FakeHerdr = fakeHerdr([
      workspace('w1', 'factory-research-aaaaaaaa'),
      workspace('w2', 'factory-canonical-cccccccc'),
    ]);
    const result: StopSessionResult = await build(herdr)('canonical-factory');
    expect(result.ok && result.stopped.session).toBe('factory-canonical-cccccccc');
    expect(herdr.closed).toEqual(['w2']);
  });

  it('refuses an ambiguous id with the candidates, and closes nothing', async () => {
    const herdr: FakeHerdr = fakeHerdr([
      workspace('w1', 'factory-research-aaaaaaaa'),
      workspace('w2', 'factory-research-bbbbbbbb'),
    ]);
    const result: StopSessionResult = await build(herdr)('research-factory');
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== 'ambiguous') throw new Error('expected ambiguous');
    expect(result.sessions.map((s: FactorySession): string => s.session)).toEqual([
      'factory-research-aaaaaaaa',
      'factory-research-bbbbbbbb',
    ]);
    expect(herdr.closed).toEqual([]);
  });

  it('reports not-found with what is running', async () => {
    const herdr: FakeHerdr = fakeHerdr([workspace('w1', 'factory-research-aaaaaaaa')]);
    const result: StopSessionResult = await build(herdr)('nope-factory');
    expect(result).toEqual({
      ok: false,
      reason: 'not-found',
      running: ['factory-research-aaaaaaaa'],
    });
  });

  it('ignores workspaces that are not factory sessions', async () => {
    const herdr: FakeHerdr = fakeHerdr([workspace('w1', 'viz')]);
    const result: StopSessionResult = await build(herdr)('viz');
    expect(result.ok).toBe(false);
    expect(herdr.closed).toEqual([]);
  });
});

describe('session meta', () => {
  it('round-trips what a restarted API needs to describe a session', async () => {
    const work: WorkDir = await makeWorkDir();
    try {
      const fs = createFsClient({});
      const at: Date = new Date('2026-10-20T10:00:00.000Z');
      await writeSessionMetaFactory({ fs, promptDir: work.promptDir })(
        buildSessionMeta(
          { session: 'factory-research-7f3a9c2b', factoryId: 'research-factory', harness: 'codex' },
          at,
        ),
      );
      const herdr: FakeHerdr = fakeHerdr([
        workspace('w1', 'factory-research-7f3a9c2b', 'working'),
        workspace('w2', 'factory-byhand-00000002'),
      ]);
      const listed: FactorySession[] = await listSessionsFactory({
        herdr: herdr.client,
        readMeta: readSessionMetaFactory({ fs, promptDir: work.promptDir }),
        now: (): Date => new Date(at.getTime() + 125_000),
      })();
      expect(listed[0]).toMatchObject({
        session: 'factory-research-7f3a9c2b',
        factoryId: 'research-factory',
        harness: 'codex',
        startedAt: at.toISOString(),
        age: '2m',
        status: 'working',
        workspaceId: 'w1',
        paneId: 'w1:p1',
      });
      expect(listed[1]).toMatchObject({ factoryId: 'byhand-factory', harness: 'unknown' });
    } finally {
      await work.cleanup();
    }
  });
});

describe('/api/v1/sessions over HTTP', () => {
  let work: WorkDir;
  let herdr: FakeHerdr;
  let api: Listening;
  let base: string;
  const uuids: string[] = [];

  beforeAll(async () => {
    work = await makeWorkDir();
    const fs = createFsClient({});
    await writeSessionMetaFactory({ fs, promptDir: work.promptDir })(
      buildSessionMeta(
        {
          session: 'factory-canonical-00000001',
          factoryId: 'canonical-factory',
          harness: 'claude',
        },
        new Date(Date.now() - 600_000),
      ),
    );
    herdr = fakeHerdr([
      workspace('w1', 'factory-canonical-00000001', 'working'),
      workspace('w2', 'factory-byhand-00000002'),
      workspace('w3', 'viz'),
    ]);
    api = await listen(
      buildTestApp(work, herdr.client, { newUuid: (): string => uuids.shift() ?? UUID }),
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
      status: 'working',
      workspaceId: 'w1',
      paneId: 'w1:p1',
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
    const started: FakeWorkspace | undefined = herdr.workspaces.find(
      (w: FakeWorkspace): boolean => w.label === body.session,
    );
    expect(started?.cwd).toBe(work.dir);
    expect(started?.commands[0]).not.toContain('pwned');
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

  it('POST 201 with params: checked against pipeline.json, coerced, every one sent in order', async () => {
    uuids.push('bbbbbbbb-0000-0000-0000-000000000000');
    const res: Response = await post('/sessions', {
      id: 'canonical-factory',
      params: { topic: 'agent factories', ratio: '0.25', deep: true, language: 'Русский' },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { prompt: string; promptFile: string };
    const expected: string =
      '/canonical-factory topic="agent factories" sub_questions=5 ratio=0.25 deep=true language="Русский"';
    expect(body.prompt).toBe(expected);
    expect(await readFile(body.promptFile, 'utf8')).toBe(expected);
    // Leave the board as the stop test below expects it: gone without a stop being recorded.
    herdr.workspaces.splice(
      herdr.workspaces.findIndex(
        (w: FakeWorkspace): boolean => w.label === 'factory-canonical-bbbbbbbb',
      ),
      1,
    );
  });

  it('POST 400 invalid params, listed like zod issues', async () => {
    const res: Response = await post('/sessions', {
      id: 'canonical-factory',
      params: { topic: 'x', sub_questions: 2.5, deep: 'maybe' },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'invalid params',
      details: [
        { path: ['params', 'sub_questions'], message: '"2.5" is not a whole number' },
        { path: ['params', 'deep'], message: '"maybe" is not a boolean' },
      ],
    });
    const badName: Response = await post('/sessions', {
      id: 'canonical-factory',
      params: { 'bad name': 'x' },
    });
    expect(badName.status).toBe(400);
    expect(await badName.json()).toMatchObject({ error: 'invalid request body' });
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
    herdr.dieOnRun.add('factory-other-deaddead');
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
    expect(herdr.closed).toHaveLength(1);

    const byId: Response = await post('/sessions/stop', { session: 'canonical' });
    expect(byId.status).toBe(200);

    const unknown: Response = await post('/sessions/stop', { session: 'canonical-factory' });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({
      details: { running: ['factory-byhand-00000002'] },
    });

    const notOurs: Response = await post('/sessions/stop', { session: 'viz' });
    expect(notOurs.status).toBe(404);
    expect(herdr.workspaces.some((w: FakeWorkspace): boolean => w.label === 'viz')).toBe(true);
  });
});
