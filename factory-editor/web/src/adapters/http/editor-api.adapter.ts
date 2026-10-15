import type { AxiosResponse } from 'axios';
import { z } from 'zod';
import { http } from './axios.adapter';
import { toApiError, type ApiError } from './api-error.utils';
import { knowledgeDocPath, pipelinePath, pipelinesPath, scriptPath } from './api-paths';
import {
  createdSchema,
  pipelineListSchema,
  savedSchema,
} from '../../features/editor/editor.schema';
import type { Created, PipelineList, Saved } from '../../features/editor/editor.types';
import {
  directoryListingSchema,
  missingNoticeSchema,
} from '../../shared/document-viewer/docs.schema';
import type {
  DocContent,
  KnowledgeDocRef,
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

/** E2 */
export const listPipelines = async (signal?: AbortSignal): Promise<PipelineList> => {
  try {
    const { data }: AxiosResponse<unknown> = await http.get(pipelinesPath(), { signal });
    return pipelineListSchema.parse(data);
  } catch (error: unknown) {
    return failWith(error);
  }
};

/** E3: the file's bytes as text, untouched, so a parse and a save round-trip the file. */
export const readPipeline = async (id: string, signal?: AbortSignal): Promise<string> => {
  try {
    const { data }: AxiosResponse<unknown> = await http.get(pipelinePath(id), {
      signal,
      responseType: 'text',
      transformResponse: identity,
    });
    return z.string().parse(data);
  } catch (error: unknown) {
    return failWith(error);
  }
};

/** E4: the serialised pipeline as the body, sent as-is so the API writes that key order. */
export const savePipeline = async (id: string, text: string): Promise<Saved> => {
  try {
    const { data }: AxiosResponse<unknown> = await http.put(pipelinePath(id), text, {
      headers: { 'Content-Type': 'application/json' },
      transformRequest: identity,
    });
    return savedSchema.parse(data);
  } catch (error: unknown) {
    return failWith(error);
  }
};

/** E4b: a new factory from the serialised pipeline; the API writes the file and the wrapper skill. */
export const createPipeline = async (text: string): Promise<Created> => {
  try {
    const { data }: AxiosResponse<unknown> = await http.post(pipelinesPath(), text, {
      headers: { 'Content-Type': 'application/json' },
      transformRequest: identity,
    });
    return createdSchema.parse(data);
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
 * lines (the file's own formatting is the truth), pretty-printed only when the file is one
 * long line.
 */
const jsonText = (raw: string, parsed: unknown): string =>
  raw.includes('\n') || parsed === undefined ? raw : JSON.stringify(parsed, null, 2);

/**
 * E5 / E12 share one reader: the answer's content type decides what the viewer gets. Every
 * status is accepted here so a `404 { error }` becomes a value, not a throw.
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
    if (missingNoticeSchema.safeParse(parsed).success) return { kind: 'missing' };
    const listing = directoryListingSchema.safeParse(parsed);
    if (listing.success)
      return { kind: 'directory', path: listing.data.path, entries: listing.data.entries };
    return { kind: 'text', text: jsonText(raw, parsed) };
  }
  if (type.includes('markdown')) return { kind: 'markdown', text: await body.text() };
  if (type.startsWith('text/')) return { kind: 'text', text: await body.text() };
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
