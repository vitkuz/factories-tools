import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Readable } from 'node:stream';
import type { ZipClient } from '../../../clients/zip/zip.types.js';
import { httpError } from '../../../shared/utils/http-error.utils.js';
import type { SiteAnswer, ZipPlan } from '../site.types.js';
import { SITE_HEADERS, renderListing } from '../site.utils.js';

export type SitePrefix = 'site' | 'zip';

const decodeOrNull = (part: string): string | null => {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
};

const pathOnly = (req: Request): string => req.originalUrl.split('?')[0] ?? '';

/**
 * The raw remainder of the URL after `/<prefix>/<pipelineId>/<runId>/`, still encoded, with
 * its trailing `/` kept (Express decodes the `*path` wildcard and drops it). The ids are found
 * by what they decode to, so any spelling of them works. `''` is the run root named with its
 * `/`; `null` is the run root named without it.
 */
export const siteRawPath = (req: Request, prefix: SitePrefix): string | null => {
  const pipelineId: string = String(req.params.pipelineId ?? '');
  const runId: string = String(req.params.runId ?? '');
  const parts: string[] = pathOnly(req).split('/');
  const at: number = parts.findIndex(
    (part: string, i: number): boolean =>
      part === prefix &&
      decodeOrNull(parts[i + 1] ?? '') === pipelineId &&
      decodeOrNull(parts[i + 2] ?? '') === runId,
  );
  if (at === -1) return '';
  const rest: string[] = parts.slice(at + 3);
  return rest.length === 0 ? null : rest.join('/');
};

/** E17/E18: every answer, errors and redirects included, is unsniffable and sends no referrer. */
export const siteHeadersMiddleware: RequestHandler = (
  _req: Request,
  res: Response,
  next: NextFunction,
): void => {
  res.set(SITE_HEADERS);
  next();
};

/**
 * Where a folder named without its `/` sends the client: its own last segment with the `/`,
 * relative and `./`-anchored, so the answer can never point off this server.
 */
const folderLocation = (req: Request): string => {
  const parts: string[] = pathOnly(req).split('/');
  return `./${parts[parts.length - 1] ?? ''}/`;
};

/** The one way an E17 answer reaches the wire. No ETag, no `X-Doc-Writable`: this is a viewer. */
export const sendSiteAnswer = (
  req: Request,
  res: Response,
  answer: SiteAnswer,
  runLabel: string,
): void => {
  switch (answer.kind) {
    case 'file':
      res.status(200);
      res.set('Content-Type', answer.contentType);
      res.set('Content-Length', String(answer.size));
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      // A file removed between the check and the read cuts the response; it never throws.
      answer
        .open()
        .on('error', (): void => {
          res.destroy();
        })
        .pipe(res);
      return;
    case 'listing': {
      // `end`, not `send`: no ETag on a page that changes as the step writes.
      const html: string = renderListing({ runLabel, path: answer.path, entries: answer.entries });
      res.status(200);
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.set('Content-Length', String(Buffer.byteLength(html, 'utf8')));
      res.end(req.method === 'HEAD' ? undefined : html);
      return;
    }
    case 'redirect':
      res.redirect(302, folderLocation(req));
      return;
    case 'not-found':
      throw httpError(404, 'not found');
    case 'refused':
      throw httpError(answer.status, answer.error);
  }
};

/**
 * E18 on the wire: the zip streams with no `Content-Length` (it is written as it is sent). A
 * client that goes away stops the zip; a read error mid-stream can only cut the response,
 * since the status line is already out — the walk before it is what keeps that rare.
 */
export const sendZip = (
  req: Request,
  res: Response,
  plan: Extract<ZipPlan, { ok: true }>,
  zip: ZipClient,
): void => {
  res.status(200);
  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', `attachment; filename="${plan.fileName}"`);
  res.set('X-Content-Type-Options', 'nosniff');
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream: Readable = zip.stream(plan.entries);
  stream.on('error', (): void => {
    res.destroy();
  });
  res.on('close', (): void => {
    stream.destroy();
  });
  stream.pipe(res);
};
