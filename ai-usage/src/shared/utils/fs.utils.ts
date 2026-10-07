import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export const expandHome = (p: string): string =>
  p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;

export const ensureDir = async (dir: string): Promise<void> => {
  await fsp.mkdir(dir, { recursive: true });
};

export const fileExists = async (p: string): Promise<boolean> =>
  fsp
    .access(p)
    .then((): boolean => true)
    .catch((): boolean => false);

export const readJsonFile = async <T>(p: string, fallback: T): Promise<T> => {
  if (!(await fileExists(p))) return fallback;
  const raw: string = await fsp.readFile(p, "utf8");
  if (raw.trim() === "") return fallback;
  return JSON.parse(raw) as T;
};

/** Atomic write: write to temp file then rename. */
export const writeJsonAtomic = async (p: string, value: unknown): Promise<void> => {
  await ensureDir(path.dirname(p));
  const tmp: string = `${p}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await fsp.rename(tmp, p);
};

export type JsonlChunk = {
  lines: string[];
  nextOffset: number;
};

/**
 * Reads complete lines of a file starting at a byte offset.
 * A trailing partial line (file still being written) is not returned and
 * the returned offset stops before it, so the next read picks it up.
 */
export const readLinesFromOffset = async (p: string, offset: number): Promise<JsonlChunk> => {
  const stat: fs.Stats = await fsp.stat(p);
  if (stat.size <= offset) return { lines: [], nextOffset: offset };
  const handle: fsp.FileHandle = await fsp.open(p, "r");
  try {
    const length: number = stat.size - offset;
    const buffer: Buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, offset);
    const text: string = buffer.toString("utf8");
    const lastNewline: number = text.lastIndexOf("\n");
    if (lastNewline === -1) return { lines: [], nextOffset: offset };
    const complete: string = text.slice(0, lastNewline);
    const consumedBytes: number = Buffer.byteLength(complete, "utf8") + 1;
    const lines: string[] = complete.split("\n").filter((l: string): boolean => l.trim() !== "");
    return { lines, nextOffset: offset + consumedBytes };
  } finally {
    await handle.close();
  }
};

export const parseJsonLines = <T = unknown>(lines: string[]): T[] =>
  lines.flatMap((line: string): T[] => {
    try {
      return [JSON.parse(line) as T];
    } catch {
      return [];
    }
  });

export const readJsonl = async <T = unknown>(p: string): Promise<T[]> => {
  const chunk: JsonlChunk = await readLinesFromOffset(p, 0);
  return parseJsonLines<T>(chunk.lines);
};

export const readFirstLine = async (p: string): Promise<string | null> => {
  const handle: fsp.FileHandle = await fsp.open(p, "r");
  try {
    const buffer: Buffer = Buffer.alloc(64 * 1024);
    const result: fsp.FileReadResult<Buffer> = await handle.read(buffer, 0, buffer.length, 0);
    const text: string = buffer.subarray(0, result.bytesRead).toString("utf8");
    const nl: number = text.indexOf("\n");
    return nl === -1 ? (text.length > 0 ? text : null) : text.slice(0, nl);
  } finally {
    await handle.close();
  }
};

export const listFilesRecursive = async (dir: string, ext: string): Promise<string[]> => {
  if (!(await fileExists(dir))) return [];
  const entries: fs.Dirent[] = await fsp.readdir(dir, { withFileTypes: true });
  const nested: string[][] = await Promise.all(
    entries.map(async (entry: fs.Dirent): Promise<string[]> => {
      const full: string = path.join(dir, entry.name);
      if (entry.isDirectory()) return listFilesRecursive(full, ext);
      return entry.isFile() && entry.name.endsWith(ext) ? [full] : [];
    }),
  );
  return nested.flat().sort();
};

export const appendLines = async (p: string, lines: string[]): Promise<void> => {
  if (lines.length === 0) return;
  await ensureDir(path.dirname(p));
  await fsp.appendFile(p, lines.map((l: string): string => `${l}\n`).join(""), "utf8");
};
