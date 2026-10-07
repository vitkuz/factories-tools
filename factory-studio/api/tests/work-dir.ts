import { request, type ClientRequest, type IncomingMessage, type Server } from 'node:http';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { createFsClient } from '../src/clients/fs/fs.client.js';
import type { FsClient } from '../src/clients/fs/fs.types.js';
import type { TmuxClient } from '../src/clients/tmux/tmux.types.js';
import { readDocumentFactory, writeDocumentFactory } from '../src/features/documents/index.js';
import {
  createFactoryFactory,
  createPipelineFactory,
  listPipelineSkillsFactory,
  listStartableFactoriesFactory,
  listPipelinesFactory,
  readKnowledgeDocumentFactory,
  readPipelineFactory,
  readPipelineFileFactory,
  savePipelineFactory,
  writePipelineFileFactory,
} from '../src/features/pipelines/index.js';
import type { PipelineServices } from '../src/features/pipelines/pipelines.types.js';
import {
  collectRunRecordsFactory,
  listRunsFactory,
  locateRunDirFactory,
  readRunDocumentFactory,
  writeRunDocumentFactory,
} from '../src/features/runs/index.js';
import type { RunServices } from '../src/features/runs/runs.types.js';
import { readScriptFactory } from '../src/features/scripts/index.js';
import {
  listSessionsFactory,
  startFactorySessionFactory,
  startSessionFactory,
  stopSessionFactory,
  writePromptFileFactory,
} from '../src/features/sessions/index.js';
import type { FactorySession } from '../src/features/sessions/sessions.types.js';
import type { AppLogger } from '../src/shared/types.js';

export const quiet: AppLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** A small valid pipeline with a top-level `hooks` key placed *between* modelled keys. */
export const CANONICAL_PIPELINE: Record<string, unknown> = {
  $schema: './pipeline.schema.json',
  id: 'canonical-factory',
  constants: {
    rootPath: '.',
    skillPath: '.',
    factoryPath: '{{rootPath}}/factories/{{id}}',
    format: 'markdown',
  },
  hooks: { after: ['bash {{rootPath}}/scripts/sync.sh {{outputDir}}'] },
  outputDir: '{{rootPath}}/run/{{id}}/{{slug}}-{{date}}',
  START: ['one'],
  steps: {
    one: {
      agent: 'claude',
      prompt: ['Read {{rootPath}}/knowledge/one.md and do the thing.'],
      knowledge: [
        '{{rootPath}}/knowledge/one.md',
        '{{rootPath}}/knowledge/agents/missing.md',
        '{{factoryPath}}/knowledge/method.md',
        '{{skillPath}}/SKILL.md',
      ],
      transitions: {
        DONE: { target: ['END'] },
        FAILED: { target: ['one'], max: 2, onMax: ['END'] },
      },
    },
  },
  description: 'test pipeline',
};

export const OTHER_PIPELINE: Record<string, unknown> = {
  id: 'other-factory',
  constants: { rootPath: 'cwd' },
  outputDir: '{{rootPath}}/run/{{id}}/{{slug}}',
  START: ['go'],
  steps: { go: { agent: 'claude', prompt: ['go'], transitions: { DONE: { target: ['END'] } } } },
};

export const RUN_A_STATE: Record<string, unknown> = {
  pipelineName: 'canonical-factory',
  createdAt: '2026-09-15T10:00:00.000Z',
  status: 'RUNNING',
  steps: {},
  someNewField: { nested: true },
};

export const RUN_A_COST: Record<string, unknown> = { totalUsd: 1.5, models: ['claude'] };

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export interface WorkDir {
  dir: string;
  promptDir: string;
  webDist: string;
  cleanup: () => Promise<void>;
}

/**
 * A temp WORK_DIR holding two wrapped factories, one factory without a wrapper skill, one
 * broken pipeline, one skill without a pipeline, a root knowledge folder (the pre-factory
 * layout) and a factory knowledge folder, four runs (stateful, stateless, garbage state, under an unknown pipeline folder)
 * and a built `dist/index.html`.
 */
export const makeWorkDir = async (): Promise<WorkDir> => {
  const dir: string = await mkdtemp(path.join(os.tmpdir(), 'factory-studio-test-'));
  const files: Record<string, string> = {
    'factories/canonical-factory/pipeline.json': json(CANONICAL_PIPELINE),
    'factories/canonical-factory/DESIGN.md': '# canonical design\n',
    'factories/canonical-factory/knowledge/method.md': '# canonical method\n',
    'factories/canonical-factory/knowledge/frameworks/mece.md': '# MECE\n',
    'factories/canonical-factory/knowledge/mandatory-output-style.md': '# Output style\n',
    '.claude/skills/canonical-factory/SKILL.md': '# canonical-factory\n',
    'factories/other-factory/pipeline.json': json(OTHER_PIPELINE),
    // a project's own factory, same layout, found before the kit's
    'factories.local/local-factory/pipeline.json': json({
      ...OTHER_PIPELINE,
      id: 'local-factory',
      constants: { rootPath: 'cwd', factoryPath: '{{rootPath}}/factories.local/{{id}}' },
    }),
    '.claude/skills/local-factory/SKILL.md': '# local wrapper\n',
    '.claude/skills/other-factory/SKILL.md': '# other-factory\n',
    '.claude/skills/create-any-factory/SKILL.md': '# create-any-factory\n',
    'factories/broken-factory/pipeline.json': '{ not json',
    'factories/unwrapped-factory/pipeline.json': json({
      ...OTHER_PIPELINE,
      id: 'unwrapped-factory',
    }),
    'knowledge/one.md': '# One\n\nHello.\n',
    'knowledge/coding/express.md': '# Express\n',
    'knowledge/coding/logo.png': 'PNG',
    'knowledge/.hidden.md': 'hidden',
    'run/canonical-factory/run-a/state.json': json(RUN_A_STATE),
    'run/canonical-factory/run-a/cost.json': json(RUN_A_COST),
    'run/canonical-factory/run-a/3-write-prd/prd.md': '# PRD\n',
    'run/canonical-factory/run-a/3-write-prd/logo.png': 'PNG',
    'run/canonical-factory/run-b/notes.md': 'no state here\n',
    'run/canonical-factory/run-c/state.json': '{ garbage',
    'run/legacy-factory/run-d/state.json': json({
      pipeline: 'legacy-factory',
      startAt: '2026-01-01T00:00:00.000Z',
    }),
    'run/legacy-factory/run-d/cost.json': '{ broken',
    'dist/index.html': '<!doctype html><title>Factory Studio</title><div id="root"></div>\n',
    'dist/assets/app.js': 'console.log("app")\n',
    'scripts/sync.sh': '#!/usr/bin/env bash\necho sync "$1"\n',
    'scripts/tools/ingest.py': 'print("ingest")\n',
    'scripts/logo.png': 'PNG',
    'scripts/huge.sh': `# ${'x'.repeat(1024 * 1024)}\n`,
  };
  for (const [rel, content] of Object.entries(files)) {
    const file: string = path.join(dir, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content, 'utf8');
  }
  // A symlink inside scripts/ that points outside it: the scripts route must refuse it.
  await symlink(path.join(dir, 'knowledge/one.md'), path.join(dir, 'scripts/escape.md'));
  return {
    dir,
    promptDir: path.join(dir, 'prompts'),
    webDist: path.join(dir, 'dist'),
    cleanup: (): Promise<void> => rm(dir, { recursive: true, force: true }),
  };
};

export interface TestAppOptions {
  apiKey?: string;
  /** `null`: no static app. Default: the work dir's `dist/`. */
  webDist?: string | null;
  newUuid?: () => string;
  now?: () => Date;
}

/** The whole app over real services and a temp WORK_DIR, the way `server.ts` wires it. */
export const buildTestApp = (
  work: WorkDir,
  tmux: TmuxClient,
  options: TestAppOptions = {},
): Express => {
  const fs: FsClient = createFsClient({});
  const workDir: string = work.dir;
  const readDocument = readDocumentFactory({ fs });
  const writeDocument = writeDocumentFactory({ fs });

  const pipelineServices: PipelineServices = {
    listPipelineSkills: listPipelineSkillsFactory({ fs, workDir, logger: quiet }),
    readPipelineFile: readPipelineFileFactory({ fs, workDir }),
    writePipelineFile: writePipelineFileFactory({ fs, workDir }),
    createFactory: createFactoryFactory({ fs, workDir }),
  };
  const runServices: RunServices = {
    collectRunRecords: collectRunRecordsFactory({ fs, workDir, logger: quiet }),
    locateRunDir: locateRunDirFactory({ fs, workDir }),
  };
  const listSessions: () => Promise<FactorySession[]> = listSessionsFactory({
    tmux,
    now: options.now,
  });

  return createApp({
    apiKey: options.apiKey,
    webDist: options.webDist === undefined ? work.webDist : options.webDist,
    logger: quiet,
    pipelines: {
      listPipelines: listPipelinesFactory(pipelineServices),
      readPipeline: readPipelineFactory(pipelineServices),
      savePipeline: savePipelineFactory({ ...pipelineServices, logger: quiet }),
      createPipeline: createPipelineFactory({ ...pipelineServices, logger: quiet }),
      readKnowledgeDocument: readKnowledgeDocumentFactory({
        ...pipelineServices,
        readDocument,
        workDir,
      }),
    },
    runs: {
      listRuns: listRunsFactory({
        ...pipelineServices,
        ...runServices,
        logger: quiet,
        now: options.now,
      }),
      readRunDocument: readRunDocumentFactory({ ...runServices, readDocument }),
      writeRunDocument: writeRunDocumentFactory({ ...runServices, writeDocument, logger: quiet }),
    },
    scripts: {
      readScript: readScriptFactory({ fs, workDir, readDocument }),
    },
    sessions: {
      startFactorySession: startFactorySessionFactory({
        workDir,
        listFactorySkills: listStartableFactoriesFactory({ fs, workDir, ...pipelineServices }),
        writePromptFile: writePromptFileFactory({ fs, promptDir: work.promptDir }),
        startSession: startSessionFactory({ tmux, graceMs: 0 }),
        logger: quiet,
        newUuid: options.newUuid,
      }),
      listSessions,
      stopSession: stopSessionFactory({ tmux, listSessions, logger: quiet }),
    },
  });
};

export interface Listening {
  /** `http://127.0.0.1:<port>` with no trailing slash. */
  origin: string;
  close: () => Promise<void>;
}

export const listen = async (app: Express): Promise<Listening> => {
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve): void => {
    server.once('listening', resolve);
  });
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: (): Promise<void> =>
      new Promise<void>((resolve): void => {
        server.close((): void => resolve());
      }),
  };
};

export interface RawResponse {
  status: number;
  body: string;
}

/**
 * A GET with the path sent verbatim. `fetch` normalises `..` and `%2e%2e` away before the
 * request leaves, so traversal attempts have to go through `node:http` to reach the server.
 */
export const rawGet = (origin: string, rawPath: string): Promise<RawResponse> =>
  new Promise<RawResponse>((resolve, reject): void => {
    const url: URL = new URL(origin);
    const req: ClientRequest = request(
      { host: url.hostname, port: Number(url.port), path: rawPath, method: 'GET' },
      (res: IncomingMessage): void => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer): void => {
          chunks.push(chunk);
        });
        res.on('end', (): void => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
