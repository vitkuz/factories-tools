import type { DocContent, DocVersion, SaveGuard } from './docs.types';

const headerOf = (headers: Readonly<Record<string, unknown>>, name: string): string | undefined => {
  const value: unknown = headers[name] ?? headers[name.toLowerCase()];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
};

/** The `ETag` / `X-Doc-Writable` headers of a document answer, as `DocContent` carries them. Pure. */
export const docVersionOf = (headers: Readonly<Record<string, unknown>>): DocVersion => {
  const etag: string | undefined = headerOf(headers, 'etag');
  const writable: string | undefined = headerOf(headers, 'x-doc-writable');
  return {
    ...(etag === undefined ? {} : { etag }),
    ...(writable === undefined ? {} : { writable: writable === 'true' }),
  };
};

/**
 * The guard a save sends: the version the editor loaded, "must not exist yet" for a doc no one
 * has written, else none (an older API that answers no ETag). Pure.
 */
export const saveGuardFor = (content: DocContent): SaveGuard =>
  (content.kind === 'markdown' || content.kind === 'text') && content.etag !== undefined
    ? { kind: 'match', etag: content.etag }
    : content.kind === 'missing'
      ? { kind: 'absent' }
      : { kind: 'any' };

type TextualContent = Extract<DocContent, { kind: 'markdown' | 'text' | 'missing' }>;

const isTextual = (content: DocContent): content is TextualContent =>
  content.kind === 'markdown' || content.kind === 'text' || content.kind === 'missing';

/**
 * May the modal offer Edit: a text document (or one not written yet) that the opener granted
 * (a human step's input) or that the API says it would accept (a knowledge file). An answer
 * that says `writable: false` wins over the opener. Pure.
 */
export const isWritableDoc = (editable: boolean, content: DocContent): boolean =>
  isTextual(content) && (content.writable ?? editable);

/** The request headers of a guard. Pure. */
export const guardHeaders = (guard: SaveGuard): Record<string, string> =>
  guard.kind === 'match'
    ? { 'If-Match': guard.etag }
    : guard.kind === 'absent'
      ? { 'If-None-Match': '*' }
      : {};
