import type { DocumentAnswer } from '../documents/documents.types.js';

/** What `server.ts` hands the scripts routes. */
export interface ScriptUsecases {
  /** One text file under `<WORK_DIR>/scripts/`, by its raw URL path. */
  readScript: (rawPath: string) => Promise<DocumentAnswer>;
}
