import type { Request, Response } from 'express';
import type { DocumentAnswer } from '../../features/documents/documents.types.js';
import { httpError } from '../utils/http-error.utils.js';

/**
 * The one way a document answer reaches the wire, shared by the knowledge and the run
 * document controllers: a file streams with its content type, a folder or a missing path is
 * a 200 JSON notice, and the refusals become the HTTP errors the edge maps. An editable file
 * carries its `ETag` (what `If-Match` names on the way back); a knowledge file or notice says
 * with `X-Doc-Writable` whether the person may rewrite it.
 */
export const sendDocumentAnswer = (req: Request, res: Response, answer: DocumentAnswer): void => {
  res.set('Cache-Control', 'no-store');
  switch (answer.kind) {
    case 'file':
      res.status(200);
      res.set('Content-Type', answer.contentType);
      res.set('Content-Length', String(answer.size));
      if (answer.etag !== undefined) res.set('ETag', answer.etag);
      if (answer.writable !== undefined) res.set('X-Doc-Writable', String(answer.writable));
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      answer.open().pipe(res);
      return;
    case 'directory':
      res.status(200).json({ kind: 'directory', path: answer.path, entries: answer.entries });
      return;
    case 'missing':
      if (answer.writable !== undefined) res.set('X-Doc-Writable', String(answer.writable));
      res.status(200).json({ kind: 'missing', path: answer.path });
      return;
    case 'not-found':
      throw httpError(404, 'not found');
    case 'refused':
      throw httpError(answer.status, answer.error);
  }
};
