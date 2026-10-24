import type { Server } from 'node:http';
import { API_PREFIX, createApp } from './app.js';
import { createFsClient } from './clients/fs/fs.client.js';
import type { FsClient } from './clients/fs/fs.types.js';
import { createHerdrClient } from './clients/herdr/herdr.client.js';
import type { HerdrClient } from './clients/herdr/herdr.types.js';
import { createTranscriptClient } from './clients/transcript/transcript.client.js';
import type { TranscriptClient } from './clients/transcript/transcript.types.js';
import {
  createChatHub,
  createTailerFactory,
  handleChatMessageFactory,
  isChatFrame,
  readTranscriptLinkFactory,
  recordSessionStartFactory,
  recordTranscriptLinkFactory,
  resolveTranscriptFactory,
} from './features/chat/index.js';
import type { ChatHub, ChatUsecases, TranscriptLink } from './features/chat/index.js';
import { readDocumentFactory, writeDocumentFactory } from './features/documents/index.js';
import {
  listPipelineSkillsFactory,
  listPipelinesFactory,
  listStartableFactoriesFactory,
  readFactoryParamsFactory,
  readKnowledgeDocumentFactory,
} from './features/pipelines/index.js';
import type { PipelineServices, PipelineUsecases } from './features/pipelines/pipelines.types.js';
import {
  collectRunRecordsFactory,
  listRunsFactory,
  locateRemovableRunFactory,
  locateRunDirFactory,
  moveRunToTrashFactory,
  readRunDocumentFactory,
  removeRunFactory,
  writeRunDocumentFactory,
} from './features/runs/index.js';
import type { RunServices, RunUsecases } from './features/runs/runs.types.js';
import {
  answerQuestionFactory,
  createQuestionStore,
  dismissQuestionFactory,
  handleClientMessageFactory,
  locateQuestionRunFactory,
  registerQuestionFactory,
  resolveQuestionFactory,
} from './features/questions/index.js';
import type { QuestionStore, QuestionUsecases } from './features/questions/questions.types.js';
import { readScriptFactory } from './features/scripts/index.js';
import type { ScriptUsecases } from './features/scripts/scripts.types.js';
import {
  listSessionsFactory,
  pollSessionStatusFactory,
  readSessionMetaFactory,
  replySessionFactory,
  startFactorySessionFactory,
  startSessionFactory,
  stopSessionFactory,
  writeHookSettingsFactory,
  writePromptFileFactory,
  writeSessionMetaFactory,
} from './features/sessions/index.js';
import type { FactorySession, SessionUsecases } from './features/sessions/sessions.types.js';
import {
  createWorkspaceFactory,
  listWorkspacesFactory,
  readWorkspacesFactory,
  removeWorkspaceFactory,
  updateWorkspaceFactory,
  writeWorkspacesFactory,
} from './features/workspaces/index.js';
import type {
  WorkspaceServices,
  WorkspaceUsecases,
} from './features/workspaces/workspaces.types.js';
import env from './shared/config/env.js';
import { HOOK_SCRIPT } from './shared/config/paths.js';
import { logger } from './shared/utils/logger.js';
import {
  attachWebSocket,
  createBroadcastBus,
  type BroadcastBus,
  type WsClient,
  type WsHub,
} from './shared/ws/index.js';

/** The real thing, assembled from the environment: clients -> services -> usecases -> app. */
const fs: FsClient = createFsClient({ logger });
const herdr: HerdrClient = createHerdrClient({
  bin: env.HERDR_BIN,
  session: env.HERDR_SESSION,
  logger,
});
const transcripts: TranscriptClient = createTranscriptClient();
const bus: BroadcastBus = createBroadcastBus();
const workDir: string = env.WORK_DIR;

const readDocument = readDocumentFactory({ fs });
const writeDocument = writeDocumentFactory({ fs });

const pipelineServices: PipelineServices = {
  listPipelineSkills: listPipelineSkillsFactory({ fs, workDir, logger }),
};
const pipelines: PipelineUsecases = {
  listPipelines: listPipelinesFactory(pipelineServices),
  readKnowledgeDocument: readKnowledgeDocumentFactory({
    ...pipelineServices,
    readDocument,
    workDir,
  }),
};

const locateRunDir = locateRunDirFactory({ fs, workDir });
const runServices: RunServices = {
  collectRunRecords: collectRunRecordsFactory({ fs, workDir, logger }),
  locateRunDir,
  locateRemovableRun: locateRemovableRunFactory({ fs, workDir, locateRunDir }),
  moveRunToTrash: moveRunToTrashFactory({ fs, workDir, logger }),
};

const scripts: ScriptUsecases = {
  readScript: readScriptFactory({ fs, workDir, readDocument }),
};

const promptDir: string = env.PROMPT_DIR;
const readSessionMeta = readSessionMetaFactory({ fs, promptDir });
const projectsDir: string = env.CLAUDE_PROJECTS_DIR;
const readTranscriptLink = readTranscriptLinkFactory({ fs, promptDir, projectsDir });
const listSessions: () => Promise<FactorySession[]> = listSessionsFactory({
  herdr,
  readMeta: readSessionMeta,
  readClaudeSessionId: async (session: string): Promise<string | null> => {
    const link: TranscriptLink | null = await readTranscriptLink(session);
    return link?.claudeSessionId ?? null;
  },
});
const runs: RunUsecases = {
  listRuns: listRunsFactory({ ...pipelineServices, ...runServices, logger }),
  readRunDocument: readRunDocumentFactory({ ...runServices, readDocument }),
  writeRunDocument: writeRunDocumentFactory({ ...runServices, writeDocument, logger }),
  // A run a live session is still in stays: the same session list GET /sessions answers with.
  removeRun: removeRunFactory({ ...runServices, listSessions, workDir, logger }),
};

const sessions: SessionUsecases = {
  startFactorySession: startFactorySessionFactory({
    workDir,
    // Only a listed pipeline may start (BR35): the list GET /pipelines answers with, narrowed
    // to the ids whose wrapper skill `/<id>` exists.
    listFactorySkills: listStartableFactoriesFactory({ fs, workDir, ...pipelineServices }),
    // A start with params is checked against the factory's `pipeline.json` as it is on disk now.
    readFactoryParams: readFactoryParamsFactory(pipelineServices),
    writePromptFile: writePromptFileFactory({ fs, promptDir }),
    writeHookSettings: writeHookSettingsFactory({
      fs,
      promptDir,
      nodePath: process.execPath,
      hookScript: HOOK_SCRIPT,
    }),
    writeSessionMeta: writeSessionMetaFactory({ fs, promptDir }),
    // The hook reaches the API over loopback whatever HOST says.
    hookEnv: {
      STUDIO_API_URL: `http://127.0.0.1:${env.PORT}`,
      ...(env.API_KEY === undefined ? {} : { STUDIO_API_KEY: env.API_KEY }),
    },
    startSession: startSessionFactory({ herdr, graceMs: env.START_GRACE_MS, logger }),
    logger,
  }),
  listSessions,
  stopSession: stopSessionFactory({ herdr, listSessions, logger }),
  replySession: replySessionFactory({ herdr, listSessions }),
};

const questionStore: QuestionStore = createQuestionStore();
const questions: QuestionUsecases = {
  registerQuestion: registerQuestionFactory({
    store: questionStore,
    broadcast: bus.broadcast,
    locateRun: locateQuestionRunFactory({
      collectRunRecords: runServices.collectRunRecords,
      readSessionMeta,
    }),
    logger,
  }),
  answerQuestion: answerQuestionFactory({ store: questionStore }),
  dismissQuestion: dismissQuestionFactory({ store: questionStore }),
  resolveQuestion: resolveQuestionFactory({ store: questionStore }),
  listPending: questionStore.list,
};

// The live chat: a tail per watched session's transcript, fed to the subscribed sockets.
const chatHub: ChatHub = createChatHub({
  resolveTranscript: resolveTranscriptFactory({
    readLink: readTranscriptLink,
    herdr,
    transcripts,
    projectsDir,
    workDir,
  }),
  createTailer: createTailerFactory({ client: transcripts, logger }),
  transcripts,
  logger,
});
const chat: ChatUsecases = {
  recordSessionStart: recordSessionStartFactory({
    recordLink: recordTranscriptLinkFactory({ fs, promptDir, projectsDir }),
    relink: chatHub.relink,
    logger,
  }),
  history: chatHub.history,
  readItem: chatHub.readItem,
};

const workspaceServices: WorkspaceServices = {
  readWorkspaces: readWorkspacesFactory({ fs, workDir, logger }),
  writeWorkspaces: writeWorkspacesFactory({ fs, workDir, logger }),
};
const workspaces: WorkspaceUsecases = {
  listWorkspaces: listWorkspacesFactory(workspaceServices),
  createWorkspace: createWorkspaceFactory(workspaceServices),
  updateWorkspace: updateWorkspaceFactory(workspaceServices),
  removeWorkspace: removeWorkspaceFactory(workspaceServices),
};

const server: Server = createApp({
  apiKey: env.API_KEY,
  webDist: env.WEB_DIST,
  pipelines,
  runs,
  scripts,
  sessions,
  questions,
  chat,
  workspaces,
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

const handleClientMessage = handleClientMessageFactory({
  usecases: questions,
  replySession: sessions.replySession,
  logger,
});
const handleChatMessage = handleChatMessageFactory({ hub: chatHub, logger });
const hub: WsHub = attachWebSocket({
  server,
  path: `${API_PREFIX}/ws`,
  apiKey: env.API_KEY,
  logger,
  onConnect: (): unknown => ({ type: 'hello', pending: questions.listPending() }),
  onMessage: (raw: string, client: WsClient): Promise<unknown> =>
    isChatFrame(raw) ? handleChatMessage(raw, client) : handleClientMessage(raw),
  onDisconnect: (client: WsClient): void => chatHub.dropClient(client.id),
});
bus.bind(hub);

const statusPoller = pollSessionStatusFactory({
  listSessions,
  broadcast: bus.broadcast,
  onSessions: (live: readonly FactorySession[]): Promise<void> =>
    chatHub.reconcile(live.map((session: FactorySession): string => session.session)),
  logger,
});
statusPoller.start();
herdr.ensureServer().catch((error: unknown): void => {
  logger.error('herdr server is not available', {
    message: error instanceof Error ? error.message : String(error),
  });
});

const shutdown = (signal: string): void => {
  logger.info('shutting down', { signal });
  // The herdr sessions are not ours to stop: they outlive the API on purpose (BR42).
  statusPoller.stop();
  chatHub.close();
  void hub.close();
  server.close((): void => process.exit(0));
  setTimeout((): void => process.exit(0), 5000).unref();
};

process.on('SIGTERM', (): void => shutdown('SIGTERM'));
process.on('SIGINT', (): void => shutdown('SIGINT'));
