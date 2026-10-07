import { isApiError } from '../../adapters/http/api-error.utils';
import { knowledgeDocPath, runDocPath, scriptPath } from '../../adapters/http/api-paths';
import {
  readKnowledgeDocument,
  readRunDocument,
  readScriptDocument,
  writeRunDocument,
} from '../../adapters/http/studio-api.adapter';
import type { DocContent, DocRef, SaveResult } from './docs.types';

export type {
  ArtifactDocRef,
  DocContent,
  DocRef,
  DocScope,
  InlineDocRef,
  KnowledgeDocRef,
  RunDocRef,
  SaveResult,
  ScriptDocRef,
} from './docs.types';

/**
 * Documents, one viewer for both screens:
 *   GET /api/v1/runs/<pipelineId>/<runId>/<path>     — a doc in the run's folder (E7)
 *   PUT /api/v1/runs/<pipelineId>/<runId>/<path>     — write it back (E8)
 *   GET /api/v1/pipelines/<pipelineId>/knowledge/<path> — a knowledge file of the factory (E5)
 * An `artifact` (an input/output path in the editor) is never fetched. Everything here is
 * pure apart from `fetchDoc` and `saveDoc`, which go through the adapter.
 */

/** The same-origin URL of a document — also what `<img src>` and links inside a doc use. */
export const docUrl = (ref: DocRef): string => {
  switch (ref.scope) {
    case 'run':
      return runDocPath(ref.pipelineId, ref.runId, ref.path);
    case 'pipeline':
      return knowledgeDocPath(ref.pipelineId, ref.path);
    case 'script':
      return scriptPath(ref.path);
    case 'artifact':
    case 'inline':
      return '';
  }
};

export const isDirectoryPath = (path: string): boolean => path.endsWith('/');

/** The folder a doc lives in, as segments (`review/screenshots/index.md` → `['review', 'screenshots']`). */
const dirSegments = (path: string): string[] => {
  const segments: string[] = path.split('/').filter(Boolean);
  return isDirectoryPath(path) ? segments : segments.slice(0, -1);
};

const stripQuery = (href: string): string => href.split(/[?#]/)[0];

/**
 * One href segment as the file name it stands for: `spaced%20name.md` → `spaced name.md`.
 * A malformed escape (`100%`) is kept as written, as a browser keeps it. A `DocRef.path`
 * holds names, not escapes — `encodeDocPath` encodes them once, on the way to the API.
 */
const decodeSegment = (seg: string): string => {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
};

/**
 * A link or image inside a doc, resolved against the doc's own folder to another doc in
 * the same scope — `screenshots/x.png` from `review/doc.md`, `../audit/doc.md` from
 * `report/doc.md`. Absolute URLs, site-absolute paths, anchors and escapes above the run
 * folder resolve to `null`.
 */
export const resolveRelative = (ref: DocRef, href: string): DocRef | null => {
  const target: string = stripQuery(href.trim());
  if (
    target === '' ||
    target.startsWith('/') ||
    target.startsWith('#') ||
    /^[a-z][a-z0-9+.-]*:/i.test(target)
  )
    return null;
  const stack: string[] = [...dirSegments(ref.path)];
  for (const seg of target.split('/').map(decodeSegment)) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    stack.push(seg);
  }
  const path: string = stack.join('/') + (target.endsWith('/') ? '/' : '');
  return path === '' ? null : { ...ref, path };
};

/** `review/screenshots/` + `index.md` → `review/screenshots/index.md`. */
export const joinDocPath = (dir: string, name: string, directory: boolean): string =>
  `${dir.replace(/\/+$/, '')}${dir === '' ? '' : '/'}${name}${directory ? '/' : ''}`;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
const MARKDOWN_EXT = /\.(md|markdown)$/i;

export const isImagePath = (path: string): boolean => IMAGE_EXT.test(path);
export const isMarkdownPath = (path: string): boolean => MARKDOWN_EXT.test(path);

const failureMessage = (error: unknown): string =>
  isApiError(error) ? error.message : error instanceof Error ? error.message : String(error);

/** Fetch a doc; every outcome is a value, never a throw. */
export const fetchDoc = async (ref: DocRef, signal?: AbortSignal): Promise<DocContent> => {
  // An artifact is written by a run, not by the editor: there is nothing to ask for.
  if (ref.scope === 'artifact') return { kind: 'editor' };
  // Inline text is already here (a prompt out of the pipeline definition).
  if (ref.scope === 'inline') return { kind: 'text', text: ref.text };
  try {
    switch (ref.scope) {
      case 'run':
        return await readRunDocument(ref, signal);
      case 'pipeline':
        return await readKnowledgeDocument(ref, signal);
      case 'script':
        return await readScriptDocument(ref, signal);
    }
  } catch (error: unknown) {
    if (signal?.aborted) return { kind: 'error', message: 'aborted' };
    return { kind: 'error', message: failureMessage(error) };
  }
};

/**
 * Write a run document back to disk through the API. Only run docs are writable — a
 * factory's knowledge file belongs to the repository, not to the run.
 */
export const saveDoc = async (ref: DocRef, text: string): Promise<SaveResult> => {
  if (ref.scope !== 'run') return { ok: false, message: 'only run documents can be edited' };
  try {
    await writeRunDocument(ref, text);
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, message: failureMessage(error) };
  }
};
