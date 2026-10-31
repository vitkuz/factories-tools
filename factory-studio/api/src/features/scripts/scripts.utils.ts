/** The one folder the scripts route reads: the repository's hook scripts. */
export const SCRIPTS_DIR = 'scripts';

/** A hook script is a short text file; 1 MB is far past any of them. */
export const MAX_SCRIPT_BYTES: number = 1024 * 1024;

/** Only what the app can show as text leaves the server: never an image or opaque bytes. Pure. */
export const isTextContentType = (contentType: string): boolean =>
  contentType.startsWith('text/') || contentType.startsWith('application/json');

/** Lives with the document helpers now (the knowledge write checks it too); re-exported here. */
export { isWithin } from '../documents/documents.utils.js';
