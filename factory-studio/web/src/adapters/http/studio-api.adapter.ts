import type { AxiosResponse } from 'axios';
import { http } from './axios.adapter';
import { toApiError, type ApiError } from './api-error.utils';
import { chatItemResponseSchema, sentMessageSchema } from '../../features/chat/chat.schema';
import type { ChatItem, SentMessage } from '../../features/chat/chat.types';
import {
  chatItemPath,
  knowledgeDocPath,
  pipelinesPath,
  runDocPath,
  runPath,
  runsPath,
  scriptPath,
  sessionMessagesPath,
  sessionsPath,
  stopSessionPath,
  systemMemoryPath,
  workspacePath,
  workspacesPath,
} from './api-paths';
import {
  pipelineListSchema,
  sessionListSchema,
  startSessionPayloadSchema,
  startedSessionSchema,
  stoppedSchema,
} from '../../features/sessions/sessions.schema';
import type {
  PipelineList,
  SessionList,
  StartSessionPayload,
  StartedSession,
  StopSessionPayload,
  Stopped,
} from '../../features/sessions/sessions.types';
import {
  createdWorkspaceSchema,
  removedWorkspaceSchema,
  workspacePayloadSchema,
  workspacesListSchema,
} from '../../features/workspaces/workspaces.schema';
import type {
  Workspace,
  WorkspacePayload,
  WorkspacesList,
} from '../../features/workspaces/workspaces.types';
import { systemMemorySchema } from '../../features/system/system.schema';
import type { SystemMemory } from '../../features/system/system.types';
import { removedRunSchema } from '../../features/runs/runs.schema';
import type { RemovedRun } from '../../features/runs/runs.types';
import type { RunRef } from '../../shared/lib/route';
import {
  directoryListingSchema,
  missingNoticeSchema,
  savedSchema,
} from '../../shared/document-viewer/docs.schema';
import { docVersionOf, guardHeaders } from '../../shared/document-viewer/docs.utils';
import type {
  DocContent,
  DocVersion,
  KnowledgeDocRef,
  RunDocRef,
  SaveGuard,
  Saved,
  ScriptDocRef,
} from '../../shared/document-viewer/docs.types';

/**
 * One function per endpoint the app calls. Each returns a value parsed by its schema and
 * throws an `ApiError` (never a raw axios error) so every screen reads failures the same way.
 */

const identity = (data: unknown): unknown => data;

const failWith = (error: unknown): never => {
  const apiError: ApiError = toApiError(error);
  throw apiError;
};

/** E2: the pipelines a session can start (read-only). */
export const listPipelines = async (signal?: AbortSignal): Promise<PipelineList> => {
  try {
    const { data }: AxiosResponse<unknown> = await http.get(pipelinesPath(), { signal });
    return pipelineListSchema.parse(data);
  } catch (error: unknown) {
    return failWith(error);
  }
};

const isJsonType = (type: string): boolean => type.includes('json');

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/**
 * A JSON file as the viewer shows it: the bytes on disk when they are already laid out in
 * lines (the recorder's own formatting is the truth), pretty-printed only when the file is
 * one long line.
 */
const jsonText = (raw: string, parsed: unknown): string =>
  raw.includes('\n') || parsed === undefined ? raw : JSON.stringify(parsed, null, 2);

/**
 * E5 / E7 share one reader: the answer's content type decides what the viewer gets. Every
 * status is accepted here so a `404 { error }` becomes a value, not a throw. A text answer
 * keeps its `ETag` (the version a save names) and `X-Doc-Writable` (knowledge only).
 */
const readDocument = async (url: string, signal?: AbortSignal): Promise<DocContent> => {
  const res: AxiosResponse<Blob> = await http.get(url, {
    signal,
    responseType: 'blob',
    validateStatus: (): boolean => true,
  });
  const type: string = String(res.headers['content-type'] ?? '');
  const body: Blob = res.data;
  const ok: boolean = res.status >= 200 && res.status < 300;
  const version: DocVersion = docVersionOf(res.headers as Readonly<Record<string, unknown>>);
  if (!ok) {
    if (type.includes('html')) return { kind: 'unavailable' };
    const parsed: unknown = isJsonType(type) ? JSON.parse(await body.text()) : {};
    const error: unknown = (parsed as { error?: unknown }).error;
    if (res.status === 404 && isJsonType(type) && error === 'not found') return { kind: 'missing' };
    if (res.status === 404 && !isJsonType(type)) return { kind: 'unavailable' };
    return { kind: 'error', message: typeof error === 'string' ? error : `HTTP ${res.status}` };
  }
  if (type.includes('html')) return { kind: 'unavailable' };
  if (type.startsWith('image/')) return { kind: 'image', url };
  if (isJsonType(type)) {
    const raw: string = await body.text();
    const parsed: unknown = parseJson(raw);
    // A file that is not there yet is a normal answer, not an error (no console noise).
    if (missingNoticeSchema.safeParse(parsed).success) {
      // Only whether it may be written: a JSON notice's own ETag is not a file's version.
      return version.writable === undefined
        ? { kind: 'missing' }
        : { kind: 'missing', writable: version.writable };
    }
    const listing = directoryListingSchema.safeParse(parsed);
    if (listing.success)
      return { kind: 'directory', path: listing.data.path, entries: listing.data.entries };
    return { kind: 'text', text: jsonText(raw, parsed), ...version };
  }
  if (type.includes('markdown')) return { kind: 'markdown', text: await body.text(), ...version };
  if (type.startsWith('text/')) return { kind: 'text', text: await body.text(), ...version };
  return { kind: 'binary' };
};

/** E5 */
export const readKnowledgeDocument = async (
  ref: KnowledgeDocRef,
  signal?: AbortSignal,
): Promise<DocContent> => {
  try {
    return await readDocument(knowledgeDocPath(ref.pipelineId, ref.path), signal);
  } catch (error: unknown) {
    return failWith(error);
  }
};

/**
 * E6: the body is returned unparsed on purpose. `parseLivePayload` in the runs feature
 * checks the envelope, then every run on its own, so one broken record is dropped and
 * named instead of failing the whole list.
 */
export const listRuns = async (signal?: AbortSignal): Promise<unknown> => {
  try {
    const { data }: AxiosResponse<unknown> = await http.get(runsPath(), { signal });
    return data;
  } catch (error: unknown) {
    return failWith(error);
  }
};

/** E7 */
export const readRunDocument = async (
  ref: RunDocRef,
  signal?: AbortSignal,
): Promise<DocContent> => {
  try {
    return await readDocument(runDocPath(ref.pipelineId, ref.runId, ref.path), signal);
  } catch (error: unknown) {
    return failWith(error);
  }
};

/** E15: moves the run to `run/.trash`; a live session in it answers 409. */
export const removeRun = async (ref: RunRef): Promise<RemovedRun> => {
  try {
    const { data }: AxiosResponse<unknown> = await http.delete(runPath(ref.pipelineId, ref.runId));
    return removedRunSchema.parse(data).removed;
  } catch (error: unknown) {
    return failWith(error);
  }
};

/** E12: a hook script of the repository, read-only. */
export const readScriptDocument = async (
  ref: ScriptDocRef,
  signal?: AbortSignal,
): Promise<DocContent> => {
  try {
    return await readDocument(scriptPath(ref.path), signal);
  } catch (error: unknown) {
    return failWith(error);
  }
};

/** The PUT of a document body: the text as it is, plus the guard's `If-Match` / `If-None-Match`. */
const putDocument = async (url: string, text: string, guard: SaveGuard): Promise<Saved> => {
  const { data }: AxiosResponse<unknown> = await http.put(url, text, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', ...guardHeaders(guard) },
    transformRequest: identity,
  });
  return savedSchema.parse(data);
};

/** E8: a 409 means the file changed on disk since the guard's version. */
export const writeRunDocument = async (
  ref: RunDocRef,
  text: string,
  guard: SaveGuard = { kind: 'any' },
): Promise<Saved> => {
  try {
    return await putDocument(runDocPath(ref.pipelineId, ref.runId, ref.path), text, guard);
  } catch (error: unknown) {
    return failWith(error);
  }
};

/** E16: a knowledge file of the project's own factory; the kit answers 403, a stale guard 409. */
export const writeKnowledgeDocument = async (
  ref: KnowledgeDocRef,
  text: string,
  guard: SaveGuard = { kind: 'any' },
): Promise<Saved> => {
  try {
    return await putDocument(knowledgeDocPath(ref.pipelineId, ref.path), text, guard);
  } catch (error: unknown) {
    return failWith(error);
  }
};

/** E9: the payload is checked by the API's own rules before it leaves. */
export const startSession = async (payload: StartSessionPayload): Promise<StartedSession> => {
  try {
    const body: StartSessionPayload = startSessionPayloadSchema.parse(payload);
    const { data }: AxiosResponse<unknown> = await http.post(sessionsPath(), body);
    return startedSessionSchema.parse(data);
  } catch (error: unknown) {
    return failWith(error);
  }
};

/** E10 */
export const listSessions = async (signal?: AbortSignal): Promise<SessionList> => {
  try {
    const { data }: AxiosResponse<unknown> = await http.get(sessionsPath(), { signal });
    return sessionListSchema.parse(data);
  } catch (error: unknown) {
    return failWith(error);
  }
};

/** E11 */
export const stopSession = async (payload: StopSessionPayload): Promise<Stopped> => {
  try {
    const { data }: AxiosResponse<unknown> = await http.post(stopSessionPath(), payload);
    return stoppedSchema.parse(data);
  } catch (error: unknown) {
    return failWith(error);
  }
};

/** A message to an idle session's Claude. The API refuses (409) when it is not idle. */
export const sendSessionMessage = async (sessionId: string, text: string): Promise<SentMessage> => {
  try {
    const { data }: AxiosResponse<unknown> = await http.post(sessionMessagesPath(sessionId), {
      text,
    });
    return sentMessageSchema.parse(data);
  } catch (error: unknown) {
    return failWith(error);
  }
};

/** One chat item uncut ("show more"): the item id and the `ref` the cut item carried. */
export const readChatItem = async (
  sessionId: string,
  itemId: string,
  ref: string,
  signal?: AbortSignal,
): Promise<ChatItem> => {
  try {
    const { data }: AxiosResponse<unknown> = await http.get(chatItemPath(sessionId, itemId), {
      params: { ref },
      signal,
    });
    return chatItemResponseSchema.parse(data).item;
  } catch (error: unknown) {
    return failWith(error);
  }
};

/** The workspaces; `problem` set means the file is there but cannot be read. */
export const listWorkspaces = async (signal?: AbortSignal): Promise<WorkspacesList> => {
  try {
    const { data }: AxiosResponse<unknown> = await http.get(workspacesPath(), { signal });
    return workspacesListSchema.parse(data);
  } catch (error: unknown) {
    return failWith(error);
  }
};

/** A new workspace; the API derives its id from the name (409 when taken). */
export const createWorkspace = async (payload: WorkspacePayload): Promise<Workspace> => {
  try {
    const body: WorkspacePayload = workspacePayloadSchema.parse(payload);
    const { data }: AxiosResponse<unknown> = await http.post(workspacesPath(), body);
    return createdWorkspaceSchema.parse(data).workspace;
  } catch (error: unknown) {
    return failWith(error);
  }
};

/** A new name and set of factories for one workspace; its id is kept. */
export const updateWorkspace = async (
  id: string,
  payload: WorkspacePayload,
): Promise<Workspace> => {
  try {
    const body: WorkspacePayload = workspacePayloadSchema.parse(payload);
    const { data }: AxiosResponse<unknown> = await http.put(workspacePath(id), body);
    return createdWorkspaceSchema.parse(data).workspace;
  } catch (error: unknown) {
    return failWith(error);
  }
};

/** Removes one workspace from the file; its factories and runs are untouched. */
export const removeWorkspace = async (id: string): Promise<Workspace> => {
  try {
    const { data }: AxiosResponse<unknown> = await http.delete(workspacePath(id));
    return removedWorkspaceSchema.parse(data).removed;
  } catch (error: unknown) {
    return failWith(error);
  }
};

/** How busy the API machine's memory is (inside WSL2, the WSL VM's). */
export const readSystemMemory = async (signal?: AbortSignal): Promise<SystemMemory> => {
  try {
    const { data }: AxiosResponse<unknown> = await http.get(systemMemoryPath(), { signal });
    return systemMemorySchema.parse(data);
  } catch (error: unknown) {
    return failWith(error);
  }
};
