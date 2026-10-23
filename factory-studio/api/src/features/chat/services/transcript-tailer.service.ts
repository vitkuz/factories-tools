import path from 'node:path';
import type { TranscriptClient } from '../../../clients/transcript/transcript.types.js';
import type { AppLogger } from '../../../shared/types.js';
import type {
  ChatItem,
  ChatLimits,
  CreateTailer,
  MapContext,
  ResolvedTranscript,
  SplitLines,
  SubagentMeta,
  TranscriptFiles,
  TranscriptLine,
  TranscriptRecord,
  TranscriptTailer,
} from '../chat.types.js';
import {
  DEFAULT_LIMITS,
  byTime,
  capItems,
  parseRecord,
  parseSubagentMeta,
  recordToItems,
  splitLines,
  subagentIdOf,
  subagentItem,
  toolUsesOf,
  transcriptFiles,
} from '../chat.utils.js';

export interface TranscriptTailerSettings {
  client: TranscriptClient;
  limits?: ChatLimits;
  /** Items held per transcript; older ones fall off (a factory run writes thousands). */
  cap?: number;
  intervalMs?: number;
  /** One read never takes more than this; a long backlog is read in several. */
  chunkBytes?: number;
  /**
   * The first read of a file starts this far from its end: the main file, and each subagent's.
   * A long factory session writes hundreds of MB; the chat shows the recent part.
   */
  backlogBytes?: { main: number; subagent: number };
  logger?: AppLogger;
}

/** Where the reading of one file has got to. Replaced, never edited, after every read. */
interface Cursor {
  /** `main`, or the subagent's id. */
  source: string;
  file: string;
  rest: Buffer;
  restStart: number;
  agent?: { agentId: string; parentToolUseId?: string; meta: SubagentMeta | null };
  /** The subagent's opening row has been sent. */
  announced: boolean;
  /** Nothing read yet: the first read may skip to the file's recent part. */
  fresh: boolean;
}

const TOOL_NAMES_CAP = 20_000;

const mainCursor = (file: string): Cursor => ({
  source: 'main',
  file,
  rest: Buffer.alloc(0),
  restStart: 0,
  announced: true,
  fresh: true,
});

/**
 * A live tail of one Claude Code transcript: the main file and every subagent file beside it
 * (`<session-id>/subagents/agent-<id>.jsonl`, found as they appear). Polls every `intervalMs`
 * (700 ms): a stat, and a read of only the bytes appended since. Complete lines become chat
 * items; a half-written last line waits for the next read.
 */
export const createTailerFactory =
  ({
    client,
    limits = DEFAULT_LIMITS,
    cap = 3000,
    intervalMs = 700,
    chunkBytes = 1024 * 1024,
    backlogBytes = { main: 8 * 1024 * 1024, subagent: 512 * 1024 },
    logger,
  }: TranscriptTailerSettings): CreateTailer =>
  (transcript: ResolvedTranscript, onItems: (items: ChatItem[]) => void): TranscriptTailer => {
    const files: TranscriptFiles = transcriptFiles(transcript.path);
    let cursors: ReadonlyMap<string, Cursor> = new Map([['main', mainCursor(files.main)]]);
    let items: readonly ChatItem[] = [];
    let dropped = 0;
    const toolNames: Map<string, string> = new Map();
    let timer: NodeJS.Timeout | undefined;
    let running: Promise<void> | null = null;
    let stopped = false;

    const remember = (record: TranscriptRecord): void => {
      for (const [id, name] of toolUsesOf(record)) toolNames.set(id, name);
      if (toolNames.size <= TOOL_NAMES_CAP) return;
      const oldest: string | undefined = toolNames.keys().next().value;
      if (oldest !== undefined) toolNames.delete(oldest);
    };

    const linesToItems = (cursor: Cursor, lines: readonly TranscriptLine[]): ChatItem[] =>
      lines.flatMap((line: TranscriptLine): ChatItem[] => {
        const record: TranscriptRecord | null = parseRecord(line.text);
        if (record === null) return [];
        remember(record);
        const ctx: MapContext = {
          toolNames,
          limits,
          line: { source: cursor.source, start: line.start, end: line.end },
          ...(cursor.agent
            ? {
                agent: {
                  agentId: cursor.agent.agentId,
                  ...(cursor.agent.parentToolUseId
                    ? { parentToolUseId: cursor.agent.parentToolUseId }
                    : {}),
                },
              }
            : {}),
        };
        return recordToItems(record, ctx);
      });

    /** Reads `cursor`'s file to its current end; the new cursor and the items it produced. */
    const drain = async (cursor: Cursor): Promise<{ cursor: Cursor; items: ChatItem[] }> => {
      const size: number | null = await client.size(cursor.file);
      if (size === null) return { cursor, items: [] };
      // A file that shrank was replaced: read it again from the top. A first read of a long file
      // starts near its end; the line it lands in is cut and is dropped as unparseable.
      const limit: number = cursor.agent ? backlogBytes.subagent : backlogBytes.main;
      const start: Cursor =
        size < cursor.restStart + cursor.rest.length
          ? { ...cursor, rest: Buffer.alloc(0), restStart: 0 }
          : cursor.fresh && size > limit
            ? { ...cursor, restStart: size - limit, fresh: false }
            : { ...cursor, fresh: false };
      let current: Cursor = start;
      let produced: ChatItem[] = [];
      while (current.restStart + current.rest.length < size && !stopped) {
        const offset: number = current.restStart + current.rest.length;
        const chunk: Buffer = await client.readRange(
          current.file,
          offset,
          Math.min(chunkBytes, size - offset),
        );
        if (chunk.length === 0) break;
        const split: SplitLines = splitLines(current.rest, current.restStart, chunk);
        const fresh: ChatItem[] = linesToItems(current, split.lines);
        const opening: ChatItem[] =
          !current.announced && current.agent && split.lines.length > 0
            ? [
                subagentItem(
                  current.agent.agentId,
                  current.agent.meta,
                  split.lines
                    .map((l: TranscriptLine): string => parseRecord(l.text)?.timestamp ?? '')
                    .find((ts: string): boolean => ts !== '') ?? new Date().toISOString(),
                ),
              ]
            : [];
        produced = [...produced, ...opening, ...fresh];
        current = {
          ...current,
          rest: split.rest,
          restStart: split.restStart,
          announced: current.announced || opening.length > 0,
        };
      }
      return { cursor: current, items: produced };
    };

    /** Subagent files that appeared since the last look, each with its meta when there is one. */
    const discover = async (): Promise<Cursor[]> => {
      const names: string[] = await client.listFiles(files.subagentsDir);
      const fresh: string[] = names
        .map(subagentIdOf)
        .filter((id: string | null): id is string => id !== null && !cursors.has(id));
      return Promise.all(
        fresh.map(async (agentId: string): Promise<Cursor> => {
          const meta: SubagentMeta | null = parseSubagentMeta(
            await client.readJson(path.join(files.subagentsDir, `agent-${agentId}.meta.json`)),
          );
          return {
            source: agentId,
            file: path.join(files.subagentsDir, `agent-${agentId}.jsonl`),
            rest: Buffer.alloc(0),
            restStart: 0,
            announced: false,
            fresh: true,
            agent: {
              agentId,
              meta,
              ...(meta?.toolUseId ? { parentToolUseId: meta.toolUseId } : {}),
            },
          };
        }),
      );
    };

    const readAll = async (): Promise<ChatItem[]> => {
      const found: Cursor[] = await discover();
      const all: Cursor[] = [...cursors.values(), ...found];
      // One file after another: the main file first, so tool names are known for the rest.
      let next: Map<string, Cursor> = new Map();
      let produced: ChatItem[] = [];
      for (const cursor of all) {
        const read: { cursor: Cursor; items: ChatItem[] } = await drain(cursor);
        next = new Map([...next, [read.cursor.source, read.cursor]]);
        produced = [...produced, ...read.items];
      }
      cursors = next;
      return byTime(produced);
    };

    const take = (fresh: readonly ChatItem[]): void => {
      if (fresh.length === 0) return;
      const capped: { items: ChatItem[]; dropped: number } = capItems([...items, ...fresh], cap);
      items = capped.items;
      dropped += capped.dropped;
    };

    const poll = (): Promise<void> => {
      if (running) return running;
      running = readAll()
        .then((fresh: ChatItem[]): void => {
          take(fresh);
          if (fresh.length > 0 && !stopped) onItems(fresh);
        })
        .catch((error: unknown): void => {
          logger?.warn('transcript read failed', {
            path: transcript.path,
            message: error instanceof Error ? error.message : String(error),
          });
        })
        .finally((): void => {
          running = null;
        });
      return running;
    };

    return {
      path: transcript.path,
      start: async (): Promise<void> => {
        take(await readAll());
        if (stopped || timer) return;
        timer = setInterval((): void => void poll(), intervalMs);
        timer.unref();
      },
      stop: (): void => {
        stopped = true;
        if (timer) clearInterval(timer);
        timer = undefined;
      },
      poll,
      snapshot: (limit: number): { items: ChatItem[]; dropped: number } => {
        const recent: { items: ChatItem[]; dropped: number } = capItems(items, limit);
        return { items: recent.items, dropped: dropped + recent.dropped };
      },
    };
  };
