import { open, readFile, readdir, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { Dirent, Stats } from 'node:fs';
import type { TranscriptClient } from './transcript.types.js';

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  ['ENOENT', 'ENOTDIR'].includes(String((error as { code?: unknown }).code));

/**
 * Claude Code's transcript files, read where they are. Nothing here writes: the transcripts
 * belong to Claude Code. A file that is not there is an answer (`null`, `[]`), not an error.
 */
export const createTranscriptClient = (): TranscriptClient => ({
  size: async (file: string): Promise<number | null> => {
    try {
      const info: Stats = await stat(file);
      return info.isFile() ? info.size : null;
    } catch (error: unknown) {
      if (isMissing(error)) return null;
      throw error;
    }
  },
  readRange: async (file: string, start: number, length: number): Promise<Buffer> => {
    const handle: FileHandle = await open(file, 'r');
    try {
      const buffer: Buffer = Buffer.alloc(length);
      const { bytesRead }: { bytesRead: number } = await handle.read(buffer, 0, length, start);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  },
  listFiles: async (dir: string): Promise<string[]> => {
    try {
      const entries: Dirent[] = await readdir(dir, { withFileTypes: true });
      return entries
        .filter((entry: Dirent): boolean => entry.isFile())
        .map((entry: Dirent): string => entry.name);
    } catch (error: unknown) {
      if (isMissing(error)) return [];
      throw error;
    }
  },
  readJson: async (file: string): Promise<unknown> => {
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch {
      return null;
    }
  },
});
