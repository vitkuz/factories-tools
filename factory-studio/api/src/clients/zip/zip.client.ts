import type { Readable } from 'node:stream';
import yazl from 'yazl';
import type { ZipClient, ZipClientSettings, ZipEntry } from './zip.types.js';

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * yazl reads each file from disk only when its turn comes, so nothing is buffered. A read
 * error (a file removed after the walk) is raised on the zip object, not on its output: it is
 * passed on to the output stream, which the caller destroys the response with.
 */
const streamFactory =
  (settings: ZipClientSettings) =>
  (entries: readonly ZipEntry[]): Readable => {
    const zip: yazl.ZipFile = new yazl.ZipFile();
    const output: Readable = zip.outputStream as Readable;
    zip.on('error', (error: unknown): void => {
      settings.logger?.warn('zip stream failed', { message: errorMessage(error) });
      output.destroy(error instanceof Error ? error : new Error(String(error)));
    });
    for (const entry of entries) zip.addFile(entry.file, entry.name, { compress: true });
    zip.end();
    return output;
  };

export const createZipClient = (settings: ZipClientSettings): ZipClient => ({
  stream: streamFactory(settings),
});
