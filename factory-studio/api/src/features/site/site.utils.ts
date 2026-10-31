import path from 'node:path';
import type { DirEntry } from '../documents/documents.types.js';
import { MIME } from '../documents/documents.utils.js';

/**
 * The browser's own types: E7 serves every page and script as plain text so it never runs on
 * the Studio origin; E17 renders them, inside the sandbox `SITE_HEADERS` puts every answer in.
 * Markdown stays text: a browser would offer to download `text/markdown`.
 */
export const SITE_MIME: Readonly<Record<string, string>> = {
  ...MIME,
  '.md': 'text/plain; charset=utf-8',
  '.markdown': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

/** Content type by extension for the preview; unknown files are opaque bytes. Pure. */
export const siteContentTypeFor = (file: string): string =>
  SITE_MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';

/**
 * On every E17 answer, errors and redirects included. `sandbox` without `allow-same-origin`
 * gives the page an opaque origin: it renders and runs its scripts, but every request it makes
 * to `/api/v1` is cross-origin, and the API sends no CORS headers.
 */
export const SITE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': 'sandbox allow-scripts allow-forms allow-popups allow-modals',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

/** What a folder serves in place of its listing, in this order. */
export const INDEX_NAMES: readonly string[] = ['index.html', 'index.htm'];

export const MAX_ZIP_ENTRIES: number = 20_000;
export const MAX_ZIP_BYTES: number = 512 * 1024 * 1024;

/** Dotfiles are hidden from the listing and the zip, and E17/E18 never serve one. Pure. */
export const isHiddenName = (name: string): boolean => name.startsWith('.');

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (char: string): string => HTML_ESCAPES[char] ?? char);

const SIZE_UNITS: readonly string[] = ['B', 'kB', 'MB', 'GB'];

/** `512 B`, `1.2 kB`, `3.4 MB` for the listing. Pure. */
export const formatSize = (bytes: number): string => {
  const step: number = Math.min(
    SIZE_UNITS.length - 1,
    bytes < 1000 ? 0 : Math.floor(Math.log10(bytes) / 3),
  );
  const value: number = bytes / 1000 ** step;
  return step === 0 ? `${bytes} B` : `${value.toFixed(1)} ${SIZE_UNITS[step]}`;
};

export interface ListingView {
  /** `<pipelineId>/<runId>`. */
  runLabel: string;
  /** `''` at the run root, else `a/b/`. */
  path: string;
  entries: readonly DirEntry[];
}

const LISTING_STYLE: string = [
  'body{margin:0;padding:24px;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#1c1c1c;background:#fff}',
  'h1{font-size:14px;font-weight:600;margin:0 0 16px;word-break:break-all}',
  'ul{list-style:none;margin:0;padding:0}li{display:flex;gap:16px;padding:2px 0}',
  'a{color:#0b57d0;text-decoration:none}a:hover{text-decoration:underline}',
  '.size{color:#6b6b6b;margin-left:auto;font-variant-numeric:tabular-nums}',
  '.muted{color:#6b6b6b}',
].join('');

const listingItem = (entry: DirEntry): string =>
  entry.type === 'directory'
    ? `<li><a href="${encodeURIComponent(entry.name)}/">${escapeHtml(entry.name)}/</a></li>`
    : `<li><a href="${encodeURIComponent(entry.name)}">${escapeHtml(entry.name)}</a><span class="size">${formatSize(entry.size)}</span></li>`;

/**
 * The page of a folder without `index.html`: inline CSS, no scripts, no external assets,
 * every name escaped. Relative hrefs only, so the links stay under the folder's own URL. Pure.
 */
export const renderListing = ({ runLabel, path: folder, entries }: ListingView): string => {
  const title: string = escapeHtml(`${runLabel}/${folder}`);
  const items: string[] = [
    ...(folder === '' ? [] : ['<li><a href="../">../</a></li>']),
    ...(entries.length === 0 ? ['<li class="muted">empty folder</li>'] : entries.map(listingItem)),
  ];
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    `<style>${LISTING_STYLE}</style></head><body>`,
    `<h1>${title}</h1>`,
    `<ul>${items.join('')}</ul>`,
    '</body></html>\n',
  ].join('\n');
};

/** A name safe in a `Content-Disposition` header: `[A-Za-z0-9._-]` only, never empty. Pure. */
export const sanitiseFileName = (name: string): string => {
  const clean: string = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '');
  return clean === '' ? 'download' : clean;
};

/** `<runId>-<folder>.zip`, or `<runId>.zip` for the run root. Pure. */
export const zipFileName = (runId: string, segments: readonly string[]): string => {
  const last: string | undefined = segments[segments.length - 1];
  return `${sanitiseFileName(last === undefined ? runId : `${runId}-${last}`)}.zip`;
};
