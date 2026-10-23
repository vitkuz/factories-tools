import type { FsClient } from '../../../clients/fs/fs.types.js';
import { buildHookSettings, settingsFileName } from '../sessions.utils.js';

export interface WriteHookSettingsSettings {
  fs: FsClient;
  promptDir: string;
  /** The node binary that runs the hook: `process.execPath`, so no PATH lookup is involved. */
  nodePath: string;
  /** Absolute path of `hooks/studio-question-hook.mjs`. */
  hookScript: string;
}

/** `<PROMPT_DIR>/<session>.settings.json`, 0600, handed to claude with `--settings`. */
export const writeHookSettingsFactory =
  ({ fs, promptDir, nodePath, hookScript }: WriteHookSettingsSettings) =>
  (session: string): Promise<string> =>
    fs.writePrivateText(
      promptDir,
      settingsFileName(session),
      JSON.stringify(buildHookSettings(nodePath, hookScript), null, 2),
    );
