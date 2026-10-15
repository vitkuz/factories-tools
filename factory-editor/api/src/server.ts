import type { Server } from 'node:http';
import { createApp } from './app.js';
import { createFsClient } from './clients/fs/fs.client.js';
import type { FsClient } from './clients/fs/fs.types.js';
import { readDocumentFactory } from './features/documents/index.js';
import {
  createFactoryFactory,
  createPipelineFactory,
  listPipelineSkillsFactory,
  listPipelinesFactory,
  readKnowledgeDocumentFactory,
  readPipelineFactory,
  readPipelineFileFactory,
  savePipelineFactory,
  writePipelineFileFactory,
} from './features/pipelines/index.js';
import type { PipelineServices, PipelineUsecases } from './features/pipelines/pipelines.types.js';
import { readScriptFactory } from './features/scripts/index.js';
import type { ScriptUsecases } from './features/scripts/scripts.types.js';
import env from './shared/config/env.js';
import { logger } from './shared/utils/logger.js';

/** The real thing, assembled from the environment: clients -> services -> usecases -> app. */
const fs: FsClient = createFsClient({ logger });
const workDir: string = env.WORK_DIR;

const readDocument = readDocumentFactory({ fs });

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

const scripts: ScriptUsecases = {
  readScript: readScriptFactory({ fs, workDir, readDocument }),
};

const server: Server = createApp({
  apiKey: env.API_KEY,
  webDist: env.WEB_DIST,
  pipelines,
  scripts,
  logger,
}).listen(env.PORT, env.HOST, (): void => {
  logger.info('factory-editor-api listening', {
    host: env.HOST,
    port: env.PORT,
    workDir,
    webDist: env.WEB_DIST,
    apiKey: env.API_KEY === undefined ? 'unset' : 'set',
  });
});

const shutdown = (signal: string): void => {
  logger.info('shutting down', { signal });
  server.close((): void => process.exit(0));
  setTimeout((): void => process.exit(0), 5000).unref();
};

process.on('SIGTERM', (): void => shutdown('SIGTERM'));
process.on('SIGINT', (): void => shutdown('SIGINT'));
