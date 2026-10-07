import type { DirEntry } from './docs.schema';

/**
 * What a link on a card or in an inspector points at: a document of the run on screen,
 * a knowledge file of the factory, or an `artifact` — an input/output path of a pipeline
 * definition, which only a run writes (the editor shows a notice for it, no request).
 */
export type DocScope = 'run' | 'knowledge' | 'artifact';

export interface RunDocRef {
  scope: 'run';
  pipelineId: string;
  runId: string;
  path: string;
}

export interface KnowledgeDocRef {
  scope: 'pipeline';
  pipelineId: string;
  path: string;
}

export interface ArtifactDocRef {
  scope: 'artifact';
  pipelineId: string;
  path: string;
}

/** A hook script of the repository: `scripts/<path>`, read-only. */
export interface ScriptDocRef {
  scope: 'script';
  path: string;
}

/**
 * Text the app already holds (a step's prompt out of the pipeline definition), shown in
 * the modal without a request. `path` is only what the header prints.
 */
export interface InlineDocRef {
  scope: 'inline';
  path: string;
  text: string;
}

export type DocRef = RunDocRef | KnowledgeDocRef | ArtifactDocRef | ScriptDocRef | InlineDocRef;

export type DocContent =
  | { kind: 'markdown'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'image'; url: string }
  | { kind: 'directory'; path: string; entries: DirEntry[] }
  | { kind: 'binary' }
  /** An `input` / `output` path opened from the editor: written by a run, so nothing to open here. */
  | { kind: 'editor' }
  | { kind: 'missing' }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string };

/** The outcome of a save; like `fetchDoc`, every failure is a value, never a throw. */
export type SaveResult = { ok: true } | { ok: false; message: string };
