import type { Server } from 'node:http';
import { createApp } from './app.js';
import { createFsClient } from './clients/fs/fs.client.js';
import type { FsClient } from './clients/fs/fs.types.js';
import { createTmuxClient } from './clients/tmux/tmux.client.js';
import type { TmuxClient } from './clients/tmux/tmux.types.js';
import { readDocumentFactory, writeDocumentFactory } from './features/documents/index.js';
import {
  createFactoryFactory,
  createPipelineFactory,
  listPipelineSkillsFactory,
  listPipelinesFactory,
  listStartableFactoriesFactory,
  readKnowledgeDocumentFactory,
  readPipelineFactory,
  readPipelineFileFactory,
  savePipelineFactory,
  writePipelineFileFactory,
} from './features/pipelines/index.js';
import type { PipelineServices, PipelineUsecases } from './features/pipelines/pipelines.types.js';
import {
  collectRunRecordsFactory,
  listRunsFactory,
  locateRunDirFactory,
  readRunDocumentFactory,
  writeRunDocumentFactory,
} from './features/runs/index.js';
import type { RunServices, RunUsecases } from './features/runs/runs.types.js';
import { readScriptFactory } from './features/scripts/index.js';
import type { ScriptUsecases } from './features/scripts/scripts.types.js';
import {
  listSessionsFactory,
  startFactorySessionFactory,
  startSessionFactory,
  stopSessionFactory,
  writePromptFileFactory,
} from './features/sessions/index.js';
import type { FactorySession, SessionUsecases } from './features/sessions/sessions.types.js';
import env from './shared/config/env.js';
import { logger } from './shared/utils/logger.js';

/** The real thing, assembled from the environment: clients -> services -> usecases -> app. */
const fs: FsClient = createFsClient({ logger });
const tmux: TmuxClient = createTmuxClient({ bin: env.TMUX_BIN, logger });
const workDir: string = env.WORK_DIR;

const readDocument = readDocumentFactory({ fs });
const writeDocument = writeDocumentFactory({ fs });

const pipelineServices: PipelineServices = {
  listPipelineSkills: listPipelineSkillsFactory({ fs, workDir, logger }),
  readPipelineFile: readPipelineFileFactory({ fs, workDir }),
  writePipelineFile: writePipelineFileFactory({ fs, workDir }),
  createFactory: createFactoryFactory({ fs, workDir }),
};
const pipelines: PipelineUsecases = {
  listPipelines: listPipelinesFactory(pipelineServices),
  readPipeline: readPipelineFactory(pipelineServices),
  savePipeline: savePipelineFactory({ ...pipelineServices, logger }),
  createPipeline: createPipelineFactory({ ...pipelineServices, logger }),
  readKnowledgeDocument: readKnowledgeDocumentFactory({
    ...pipelineServices,
    readDocument,
    workDir,
  }),
};

const runServices: RunServices = {
  collectRunRecords: collectRunRecordsFactory({ fs, workDir, logger }),
  locateRunDir: locateRunDirFactory({ fs, workDir }),
};
const runs: RunUsecases = {
  listRuns: listRunsFactory({ ...pipelineServices, ...runServices, logger }),
  readRunDocument: readRunDocumentFactory({ ...runServices, readDocument }),
  writeRunDocument: writeRunDocumentFactory({ ...runServices, writeDocument, logger }),
};

const scripts: ScriptUsecases = {
  readScript: readScriptFactory({ fs, workDir, readDocument }),
};

const listSessions: () => Promise<FactorySession[]> = listSessionsFactory({ tmux });
const sessions: SessionUsecases = {
  startFactorySession: startFactorySessionFactory({
    workDir,
    // Only a listed pipeline may start (BR35): the list GET /pipelines answers with, narrowed
    // to the ids whose wrapper skill `/<id>` exists.
    listFactorySkills: listStartableFactoriesFactory({ fs, workDir, ...pipelineServices }),
    writePromptFile: writePromptFileFactory({ fs, promptDir: env.PROMPT_DIR }),
    startSession: startSessionFactory({ tmux, graceMs: env.START_GRACE_MS, logger }),
    logger,
  }),
  listSessions,
  stopSession: stopSessionFactory({ tmux, listSessions, logger }),
};

const server: Server = createApp({
  apiKey: env.API_KEY,
  webDist: env.WEB_DIST,
  pipelines,
  runs,
  scripts,
  sessions,
  logger,
}).listen(env.PORT, env.HOST, (): void => {
  logger.info('factory-studio-api listening', {
    host: env.HOST,
    port: env.PORT,
    workDir,
    webDist: env.WEB_DIST,
    promptDir: env.PROMPT_DIR,
    apiKey: env.API_KEY === undefined ? 'unset' : 'set',
  });
});

const shutdown = (signal: string): void => {
  logger.info('shutting down', { signal });
  // The tmux sessions are not ours to stop: they outlive the API on purpose (BR42).
  server.close((): void => process.exit(0));
  setTimeout((): void => process.exit(0), 5000).unref();
};

process.on('SIGTERM', (): void => shutdown('SIGTERM'));
process.on('SIGINT', (): void => shutdown('SIGINT'));
