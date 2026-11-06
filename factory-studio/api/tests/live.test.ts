import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createFsClient } from '../src/clients/fs/fs.client.js';
import type { FsClient } from '../src/clients/fs/fs.types.js';
import { createWatchClient } from '../src/clients/watch/watch.client.js';
import {
  createActiveRunTracker,
  createMemoryTicker,
  createRunSweeper,
  createSubscriptionRegistry,
  handleLiveMessageFactory,
  isLiveFrame,
  publishRunChangeFactory,
  sendSnapshotFactory,
  watchLiveSourcesFactory,
} from '../src/features/live/index.js';
import type {
  ActiveRunTracker,
  LiveServerMessage,
  LiveWatchers,
  RunKey,
  SubscriptionRegistry,
} from '../src/features/live/index.js';
import type { FileInfo } from '../src/clients/fs/fs.types.js';
import { listPipelineSkillsFactory } from '../src/features/pipelines/index.js';
import {
  collectRunRecordsFactory,
  listRunsFactory,
  readRunRecordFactory,
} from '../src/features/runs/index.js';
import type { RunRecord } from '../src/features/runs/index.js';
import { pollSessionStatusFactory } from '../src/features/sessions/index.js';
import type { FactorySession } from '../src/features/sessions/sessions.types.js';
import type { SystemMemoryResponse } from '../src/features/system/system.types.js';
import {
  listWorkspacesFactory,
  readWorkspacesFactory,
  writeWorkspacesFactory,
} from '../src/features/workspaces/index.js';
import { attachWebSocket, type WsClient, type WsHub } from '../src/shared/ws/index.js';
import { makeWorkDir, quiet, RUN_A_STATE, type WorkDir } from './work-dir.js';

const MEMORY: SystemMemoryResponse = {
  totalBytes: 100,
  usedBytes: 40,
  availableBytes: 60,
  usedPercent: 40,
  loadAverage: [0.1, 0.2, 0.3],
  cpuCount: 4,
};

const fakeClient = (id: string): WsClient & { sent: LiveServerMessage[] } => {
  const sent: LiveServerMessage[] = [];
  return {
    id,
    sent,
    send: (message: unknown): void => void sent.push(message as LiveServerMessage),
  };
};

/** Resolves with the first message `pick` accepts, or rejects after `ms`. */
const waitFor = <T>(
  pick: () => T | undefined,
  ms: number = 3000,
  everyMs: number = 20,
): Promise<T> =>
  new Promise<T>((resolve, reject): void => {
    const started: number = Date.now();
    const look = (): void => {
      const found: T | undefined = pick();
      if (found !== undefined) {
        resolve(found);
        return;
      }
      if (Date.now() - started > ms) {
        reject(new Error('timed out'));
        return;
      }
      setTimeout(look, everyMs);
    };
    look();
  });

describe('subscription registry', () => {
  it('publishes to the subscribers of a topic only, and forgets a dropped client', () => {
    const registry: SubscriptionRegistry = createSubscriptionRegistry();
    const a = fakeClient('a');
    const b = fakeClient('b');
    registry.subscribe(a, ['runs', 'system']);
    registry.subscribe(b, ['sessions']);
    registry.publish('runs', { type: 'pipelines.changed', pipelines: {} });
    registry.publish('sessions', { type: 'sessions.changed', sessions: [] });
    expect(a.sent.map((m: LiveServerMessage): string => m.type)).toEqual(['pipelines.changed']);
    expect(b.sent.map((m: LiveServerMessage): string => m.type)).toEqual(['sessions.changed']);
    expect(registry.count('runs')).toBe(1);
    registry.unsubscribe('a', ['runs']);
    expect(registry.count('runs')).toBe(0);
    expect(registry.count('system')).toBe(1);
    registry.drop('a');
    expect(registry.count('system')).toBe(0);
    registry.publish('system', { type: 'system.memory', ...MEMORY });
    expect(a.sent).toHaveLength(1);
  });
});

describe('memory ticker', () => {
  it('reads and publishes only while someone listens', async () => {
    const registry: SubscriptionRegistry = createSubscriptionRegistry();
    let reads = 0;
    const ticker = createMemoryTicker({
      registry,
      readMemory: async (): Promise<SystemMemoryResponse> => {
        reads += 1;
        return MEMORY;
      },
    });
    await ticker.tick();
    expect(reads).toBe(0);
    const c = fakeClient('c');
    registry.subscribe(c, ['system']);
    await ticker.tick();
    expect(reads).toBe(1);
    expect(c.sent).toEqual([{ type: 'system.memory', ...MEMORY }]);
  });
});

describe('active run tracker and mtime sweep', () => {
  const info = (mtimeMs: number, size: number): FileInfo => ({
    isFile: true,
    isDirectory: false,
    size,
    mtimeMs,
  });

  it('tracks the runs that may still move, from single reads and from lists', () => {
    const tracker: ActiveRunTracker = createActiveRunTracker();
    tracker.note('p', 'a', 'RUNNING');
    tracker.note('p', 'b', 'COMPLETED');
    tracker.note('p', 'c', 'IDLE');
    expect(
      tracker
        .active()
        .map((k: RunKey): string => k.runId)
        .sort(),
    ).toEqual(['a', 'c']);
    tracker.note('p', 'a', 'FAILED');
    tracker.forget('p', 'c');
    expect(tracker.active()).toEqual([]);
    tracker.noteRecords([
      {
        runId: 'd',
        pipelineId: 'p',
        dir: 'run/p/d',
        hasState: true,
        state: { status: 'PAUSED' },
        cost: null,
        hasCost: false,
      },
      {
        runId: 'e',
        pipelineId: 'p',
        dir: 'run/p/e',
        hasState: false,
        state: null,
        cost: null,
        hasCost: false,
      },
      {
        runId: 'f',
        pipelineId: 'p',
        dir: 'run/p/f',
        hasState: true,
        state: { status: 'COMPLETED' },
        cost: null,
        hasCost: false,
      },
    ] as RunRecord[]);
    expect(
      tracker
        .active()
        .map((k: RunKey): string => k.runId)
        .sort(),
    ).toEqual(['d', 'e']);
  });

  it('reports a run only when its state.json or cost.json mtime or size moved', async () => {
    const tracker: ActiveRunTracker = createActiveRunTracker();
    tracker.note('p', 'a', 'RUNNING');
    tracker.note('p', 'b', 'RUNNING');
    let files: Record<string, FileInfo | null> = {
      'run/p/a/state.json': info(1000, 10),
      'run/p/a/cost.json': null,
      'run/p/b/state.json': info(1000, 10),
      'run/p/b/cost.json': info(1000, 5),
    };
    const changed: [string, string[]][] = [];
    const sweeper = createRunSweeper({
      fs: {
        stat: async (file: string): Promise<FileInfo | null> =>
          files[file.slice(file.indexOf('run/'))] ?? null,
      },
      workDir: '/w',
      tracker,
      onChanged: (key: RunKey, paths: string[]): void => void changed.push([key.runId, paths]),
      logger: quiet,
    });
    await sweeper.tick();
    expect(changed).toEqual([]);
    await sweeper.tick();
    expect(changed).toEqual([]);
    // a: the recorder rewrote state.json (new mtime, same size); b: cost.json appeared bigger.
    files = { ...files, 'run/p/a/state.json': info(2000, 10), 'run/p/b/cost.json': info(1000, 9) };
    await sweeper.tick();
    expect(changed).toEqual([
      ['a', ['state.json']],
      ['b', ['cost.json']],
    ]);
    // A run that finished is no longer swept.
    tracker.note('a' === 'a' ? 'p' : 'p', 'a', 'COMPLETED');
    files = { ...files, 'run/p/a/state.json': info(3000, 10) };
    await sweeper.tick();
    expect(changed).toHaveLength(2);
  });
});

describe('session poller onChanged', () => {
  const session = (
    name: string,
    status: FactorySession['status'],
    age: number,
  ): FactorySession => ({
    session: name,
    factoryId: 'a-factory',
    harness: 'claude',
    startedAt: '2026-01-01T00:00:00.000Z',
    ageSeconds: age,
    age: `${age}s`,
    status,
  });

  it('fires on the first poll and on every change, not on an age tick', async () => {
    let current: FactorySession[] = [session('a', 'working', 1)];
    const changes: number[] = [];
    const poller = pollSessionStatusFactory({
      listSessions: async (): Promise<FactorySession[]> => current,
      broadcast: (): void => {},
      onChanged: (sessions: readonly FactorySession[]): void => void changes.push(sessions.length),
    });
    await poller.tick();
    current = [session('a', 'working', 3)];
    await poller.tick();
    current = [session('a', 'working', 5), session('b', 'idle', 0)];
    await poller.tick();
    current = [session('a', 'blocked', 7), session('b', 'idle', 2)];
    await poller.tick();
    expect(changes).toEqual([1, 2, 2]);
  });
});

describe('live feed over the socket and the disk', () => {
  let work: WorkDir;
  let server: Server;
  let hub: WsHub;
  let url: string;
  let registry: SubscriptionRegistry;
  let watchers: LiveWatchers;
  let fs: FsClient;

  beforeAll(async () => {
    work = await makeWorkDir();
    fs = createFsClient({});
    const workDir: string = work.dir;
    const listPipelineSkills = listPipelineSkillsFactory({ fs, workDir, logger: quiet });
    const collectRunRecords = collectRunRecordsFactory({ fs, workDir, logger: quiet });
    const listRuns = listRunsFactory({ listPipelineSkills, collectRunRecords, logger: quiet });
    const listWorkspaces = listWorkspacesFactory({
      readWorkspaces: readWorkspacesFactory({ fs, workDir, logger: quiet }),
      writeWorkspaces: writeWorkspacesFactory({ fs, workDir, logger: quiet }),
    });
    registry = createSubscriptionRegistry();
    const handleLive = handleLiveMessageFactory({
      registry,
      sendSnapshot: sendSnapshotFactory({
        listRuns,
        listSessions: async (): Promise<FactorySession[]> => [],
        listWorkspaces,
        readMemory: async (): Promise<SystemMemoryResponse> => MEMORY,
      }),
      logger: quiet,
    });
    server = createServer();
    hub = attachWebSocket({
      server,
      path: '/api/v1/ws',
      logger: quiet,
      onConnect: (): unknown => ({ type: 'hello', pending: [] }),
      onMessage: (raw: string, client: WsClient): Promise<unknown> =>
        isLiveFrame(raw) ? handleLive(raw, client) : Promise.resolve(null),
      onDisconnect: (client: WsClient): void => registry.drop(client.id),
    });
    await new Promise<void>((resolve): void => {
      server.listen(0, '127.0.0.1', resolve);
    });
    url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/ws`;
    watchers = watchLiveSourcesFactory({
      watch: createWatchClient({ logger: quiet }),
      workDir,
      publisher: publishRunChangeFactory({
        registry,
        readRunRecord: readRunRecordFactory({ fs, workDir, logger: quiet }),
        listRuns,
        listWorkspaces,
        logger: quiet,
      }),
      publishPipelines: async (): Promise<void> => {
        registry.publish('runs', { type: 'pipelines.changed', pipelines: { edited: true } });
      },
      runDebounceMs: 100,
      pipelinesDebounceMs: 100,
      logger: quiet,
    })();
  });

  afterAll(async () => {
    watchers.stop();
    await hub.close();
    server.closeAllConnections();
    await new Promise<void>((resolve): void => {
      server.close((): void => resolve());
    });
    await work.cleanup();
  });

  let ws: WebSocket;
  let frames: LiveServerMessage[];

  beforeEach(async () => {
    frames = [];
    ws = new WebSocket(url);
    ws.on('message', (data: WebSocket.RawData): void => {
      frames.push(JSON.parse(String(data)) as LiveServerMessage);
    });
    await new Promise<void>((resolve): void => {
      ws.once('open', (): void => resolve());
    });
  });

  afterEach(() => {
    ws.close();
  });

  const ofType = <T extends LiveServerMessage['type']>(
    type: T,
  ): Extract<LiveServerMessage, { type: T }> | undefined =>
    frames.find((f: LiveServerMessage): boolean => f.type === type) as
      Extract<LiveServerMessage, { type: T }> | undefined;

  it('answers a subscribe with one snapshot per topic', async () => {
    ws.send(
      JSON.stringify({
        type: 'live.subscribe',
        topics: ['runs', 'workspaces', 'system', 'sessions'],
      }),
    );
    const snapshot = await waitFor(() => ofType('runs.snapshot'));
    expect((snapshot.runs as RunRecord[]).map((r: RunRecord): string => r.runId).sort()).toEqual([
      'run-a',
      'run-b',
      'run-d',
    ]);
    expect(Object.keys(snapshot.pipelines).sort()).toEqual([
      'canonical-factory',
      'local-factory',
      'other-factory',
      'unwrapped-factory',
    ]);
    expect((await waitFor(() => ofType('workspaces.snapshot'))).exists).toBe(false);
    expect((await waitFor(() => ofType('system.memory'))).usedPercent).toBe(40);
    expect((await waitFor(() => ofType('sessions.changed'))).sessions).toEqual([]);
    expect(registry.count('runs')).toBe(1);
  });

  it('refuses a frame that breaks the schema', async () => {
    ws.send(JSON.stringify({ type: 'live.subscribe', topics: ['everything'] }));
    const error = await waitFor(() =>
      frames.find((f): boolean => (f as { type: string }).type === 'error'),
    );
    expect(error).toEqual({ type: 'error', message: 'invalid message' });
  });

  it('pushes run.changed with the record when state.json is written the way the recorder does', async () => {
    ws.send(JSON.stringify({ type: 'live.subscribe', topics: ['runs'] }));
    await waitFor(() => ofType('runs.snapshot'));
    const runDir: string = path.join(work.dir, 'run/canonical-factory/zz-live-test');
    await mkdir(runDir, { recursive: true });
    const started: number = Date.now();
    const tmp: string = path.join(runDir, 'state.json.tmp-1');
    await writeFile(tmp, `${JSON.stringify({ ...RUN_A_STATE, status: 'COMPLETED' }, null, 2)}\n`);
    await rename(tmp, path.join(runDir, 'state.json'));
    const changed = await waitFor(() =>
      frames.find(
        (f): f is Extract<LiveServerMessage, { type: 'run.changed' }> =>
          f.type === 'run.changed' && f.runId === 'zz-live-test' && f.run != null,
      ),
    );
    expect(Date.now() - started).toBeLessThan(2000);
    expect(changed.folder).toBe('canonical-factory');
    expect(changed.pipelineId).toBe('canonical-factory');
    expect((changed.run as RunRecord).state?.status).toBe('COMPLETED');
    expect(changed.paths).toContain('state.json');
    // The temp file never shows up as a path of its own.
    expect(changed.paths.some((p: string): boolean => p.endsWith('.tmp-1'))).toBe(false);

    // Output files only: the paths, no record.
    frames.length = 0;
    await mkdir(path.join(runDir, '1-step'), { recursive: true });
    await writeFile(path.join(runDir, '1-step/out.md'), '# out\n');
    const files = await waitFor(() =>
      frames.find(
        (f): f is Extract<LiveServerMessage, { type: 'run.changed' }> =>
          f.type === 'run.changed' && f.runId === 'zz-live-test',
      ),
    );
    expect(files.paths).toContain('1-step/out.md');
    expect('run' in files).toBe(false);

    // Gone: the run leaves the feed.
    frames.length = 0;
    await rm(runDir, { recursive: true, force: true });
    const gone = await waitFor(() =>
      frames.find(
        (f): f is Extract<LiveServerMessage, { type: 'run.changed' }> =>
          f.type === 'run.changed' && f.runId === 'zz-live-test' && f.run === null,
      ),
    );
    expect(gone.reason).toBe('gone');
  });

  it('keeps pushing run.changed for a new folder written recorder-style six times over', async () => {
    ws.send(JSON.stringify({ type: 'live.subscribe', topics: ['runs'] }));
    await waitFor(() => ofType('runs.snapshot'));
    const runDir: string = path.join(work.dir, 'run/canonical-factory/zz-rewrites');
    await mkdir(runDir, { recursive: true });
    for (let n = 1; n <= 6; n += 1) {
      frames.length = 0;
      const tmp: string = path.join(runDir, `state.json.tmp-${n}`);
      await writeFile(
        tmp,
        `${JSON.stringify({ ...RUN_A_STATE, status: 'RUNNING', n }, null, 2)}\n`,
      );
      await rename(tmp, path.join(runDir, 'state.json'));
      const pushed = await waitFor(() =>
        frames.find(
          (f): f is Extract<LiveServerMessage, { type: 'run.changed' }> =>
            f.type === 'run.changed' &&
            f.runId === 'zz-rewrites' &&
            (f.run as { state?: { n?: number } } | null | undefined)?.state?.n === n,
        ),
      );
      expect(pushed.paths).toContain('state.json');
    }
    await rm(runDir, { recursive: true, force: true });
  });

  it('pushes workspaces.snapshot when run/workspaces.json is written, and pipelines.changed for a pipeline.json', async () => {
    ws.send(JSON.stringify({ type: 'live.subscribe', topics: ['runs', 'workspaces'] }));
    await waitFor(() => ofType('workspaces.snapshot'));
    frames.length = 0;
    await writeFile(
      path.join(work.dir, 'run/workspaces.json'),
      `${JSON.stringify({ workspaces: [{ id: 'k', name: 'K', pipelines: ['canonical-factory'] }] })}\n`,
    );
    const snapshot = await waitFor(() => ofType('workspaces.snapshot'));
    expect(snapshot.exists).toBe(true);
    expect((snapshot.workspaces as { id: string }[]).map((w): string => w.id)).toEqual(['k']);

    await writeFile(
      path.join(work.dir, 'factories/other-factory/pipeline.json'),
      `${JSON.stringify({ id: 'other-factory', START: ['go'], steps: {} })}\n`,
    );
    expect((await waitFor(() => ofType('pipelines.changed'))).pipelines).toEqual({ edited: true });
  });
});
