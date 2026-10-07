import { lazy } from 'react';

/** The markdown renderer is its own chunk, fetched the first time a document is opened. */
export const LazyDocModal = lazy(() => import('./DocModal'));

export { default as DocLink, DocOpenContext, useOpenDoc } from './DocLink';
export type { OpenDoc, OpenDocOptions } from './DocLink';
export {
  docUrl,
  fetchDoc,
  saveDoc,
  resolveRelative,
  joinDocPath,
  isDirectoryPath,
  isImagePath,
  isMarkdownPath,
} from './docs';
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
export type { DirEntry, DirectoryListing } from './docs.schema';
export { extLabel, extensionOf, languageOf, languageOfName } from './highlight.utils';
export type { Language } from './highlight.utils';
