import type { FsClient } from '../../../clients/fs/fs.types.js';

export interface WritePromptFileSettings {
  fs: FsClient;
  promptDir: string;
}

/**
 * The prompt goes to disk, not into a command line: `<PROMPT_DIR>/<session>.prompt`, 0600 in
 * a 0700 folder. The harness reads the file, so nothing in the prompt is ever a shell word.
 */
export const writePromptFileFactory =
  ({ fs, promptDir }: WritePromptFileSettings) =>
  (session: string, text: string): Promise<string> =>
    fs.writePrivateText(promptDir, `${session}.prompt`, text);
