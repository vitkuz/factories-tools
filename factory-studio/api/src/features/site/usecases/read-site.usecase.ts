import path from 'node:path';
import type { DirEntryInfo, FsClient } from '../../../clients/fs/fs.types.js';
import type { DirEntry, ParseDocPathResult } from '../../documents/documents.types.js';
import { parseDocPath, sortEntries } from '../../documents/documents.utils.js';
import type {
  ReadSiteResult,
  ResolveRunPathResult,
  SiteAnswer,
  SiteServices,
} from '../site.types.js';
import { INDEX_NAMES, isHiddenName, siteContentTypeFor } from '../site.utils.js';

export interface ReadSiteSettings extends Pick<SiteServices, 'locateRunDir' | 'resolveRunPath'> {
  fs: FsClient;
}

const toDirEntry = (entry: DirEntryInfo): DirEntry => ({
  name: entry.name,
  type: entry.isDirectory ? 'directory' : 'file',
  size: entry.isFile ? entry.size : 0,
});

/**
 * One path of a run folder as a site: a file with its browser type, a folder's `index.html`
 * (each held inside the run once symlinks are followed), the folder's listing, or a redirect
 * to the folder's own URL with `/` so the page's relative links resolve under it. Read-only.
 */
export const readSiteFactory =
  ({ locateRunDir, resolveRunPath, fs }: ReadSiteSettings) =>
  async (pipelineId: string, runId: string, rawPath: string | null): Promise<ReadSiteResult> => {
    let segments: string[] = [];
    let directory: boolean = rawPath === null || rawPath === '';
    if (rawPath !== null && rawPath !== '') {
      const parsed: ParseDocPathResult = parseDocPath(rawPath);
      if (!parsed.ok) {
        return {
          ok: true,
          answer: { kind: 'refused', status: parsed.status, error: parsed.error },
        };
      }
      segments = parsed.parsed.segments;
      directory = parsed.parsed.directory;
    }

    const runDir: string | null = await locateRunDir(pipelineId, runId);
    if (runDir === null) return { ok: false, reason: 'run-not-found' };
    if (rawPath === null) return { ok: true, answer: { kind: 'redirect' } };

    const answer = (value: SiteAnswer): ReadSiteResult => ({ ok: true, answer: value });
    const target: ResolveRunPathResult = await resolveRunPath(runDir, segments);
    if (!target.ok) {
      return answer(
        target.reason === 'missing'
          ? { kind: 'not-found' }
          : { kind: 'refused', status: target.status, error: target.error },
      );
    }

    if (target.kind === 'file') {
      if (directory) return answer({ kind: 'not-found' });
      return answer({
        kind: 'file',
        file: target.file,
        size: target.size,
        contentType: siteContentTypeFor(target.file),
        open: () => fs.openRead(target.file),
      });
    }

    if (!directory) return answer({ kind: 'redirect' });
    for (const name of INDEX_NAMES) {
      const index: ResolveRunPathResult = await resolveRunPath(runDir, [...segments, name]);
      if (index.ok && index.kind === 'file') {
        return answer({
          kind: 'file',
          file: index.file,
          size: index.size,
          contentType: siteContentTypeFor(name),
          open: () => fs.openRead(index.file),
        });
      }
    }
    const listed: DirEntryInfo[] = await fs.listDir(target.file);
    const visible: DirEntry[] = listed
      .filter(
        (entry: DirEntryInfo): boolean =>
          !isHiddenName(entry.name) && (entry.isFile || entry.isDirectory),
      )
      .map(toDirEntry);
    return answer({
      kind: 'listing',
      path: segments.length === 0 ? '' : `${path.posix.join(...segments)}/`,
      entries: sortEntries(visible),
    });
  };
