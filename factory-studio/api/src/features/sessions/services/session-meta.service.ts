import path from 'node:path';
import type { FsClient } from '../../../clients/fs/fs.types.js';
import type { SessionMeta } from '../sessions.types.js';
import { metaFileName, parseSessionMeta } from '../sessions.utils.js';

export interface SessionMetaSettings {
  fs: FsClient;
  promptDir: string;
}

/** `<PROMPT_DIR>/<session>.meta.json`, 0600: what `GET /sessions` needs again after a restart. */
export const writeSessionMetaFactory =
  ({ fs, promptDir }: SessionMetaSettings) =>
  (meta: SessionMeta): Promise<string> =>
    fs.writePrivateText(promptDir, metaFileName(meta.session), JSON.stringify(meta));

export const readSessionMetaFactory =
  ({ fs, promptDir }: SessionMetaSettings) =>
  async (session: string): Promise<SessionMeta | null> => {
    const read = await fs.readJson(path.join(promptDir, metaFileName(session)));
    return read.ok ? parseSessionMeta(read.value) : null;
  };
