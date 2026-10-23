import path from 'node:path';
import type { TranscriptClient } from '../../../clients/transcript/transcript.types.js';
import type { AppLogger } from '../../../shared/types.js';
import type { WsClient } from '../../../shared/ws/ws.types.js';
import type {
  ChatHistoryResult,
  ChatHub,
  ChatItem,
  ChatItemResult,
  ChatServerMessage,
  ChatUnavailableReason,
  CreateTailer,
  LineSource,
  MapContext,
  ResolvedTranscript,
  SubagentMeta,
  TranscriptRecord,
  TranscriptTailer,
} from '../chat.types.js';
import {
  FULL_LIMITS,
  parseRecord,
  parseRef,
  parseSubagentMeta,
  recordToItems,
  transcriptFiles,
} from '../chat.utils.js';
import type { ResolveTranscriptResult } from './transcript-link.service.js';

export interface ChatHubSettings {
  resolveTranscript: (session: string) => Promise<ResolveTranscriptResult>;
  createTailer: CreateTailer;
  transcripts: Pick<TranscriptClient, 'readRange' | 'readJson'>;
  /** Items a subscriber is sent on subscribe; older ones are counted in `dropped`. */
  backlogItems?: number;
  logger?: AppLogger;
}

/** One watched session. Replaced in the map, never edited. */
interface Watch {
  subscribers: ReadonlyMap<string, WsClient>;
  transcript?: ResolvedTranscript;
  tailer?: TranscriptTailer;
  /** The tail is being started; subscribers that arrive meanwhile wait for it. */
  starting?: Promise<void>;
  /** Why the last attempt found nothing to tail; said once, not on every retry. */
  unavailable?: ChatUnavailableReason;
}

/** A line bigger than this is not a transcript record; `ref` reads refuse it. */
const MAX_LINE_BYTES = 64 * 1024 * 1024;

/**
 * Who watches which session's chat, and the one tailer per watched session that feeds them.
 * A tailer starts with the first subscriber and stops with the last, or when the session is
 * gone from herdr. A session whose transcript is not known yet (the SessionStart hook has not
 * reported) stays subscribed and is tried again on every status poll.
 */
export const createChatHub = ({
  resolveTranscript,
  createTailer,
  transcripts,
  backlogItems = 1000,
  logger,
}: ChatHubSettings): ChatHub => {
  let watches: ReadonlyMap<string, Watch> = new Map();

  const put = (sessionId: string, watch: Watch | null): void => {
    const next: Map<string, Watch> = new Map(watches);
    if (watch === null) next.delete(sessionId);
    else next.set(sessionId, watch);
    watches = next;
  };

  const sendTo = (clients: Iterable<WsClient>, message: ChatServerMessage): void => {
    for (const client of clients) client.send(message);
  };

  const backlogOf = (
    sessionId: string,
    transcript: ResolvedTranscript,
    tailer: TranscriptTailer,
  ): ChatServerMessage => {
    const snapshot: { items: ChatItem[]; dropped: number } = tailer.snapshot(backlogItems);
    return {
      type: 'session.chat.backlog',
      sessionId,
      claudeSessionId: transcript.claudeSessionId,
      items: snapshot.items,
      dropped: snapshot.dropped,
    };
  };

  const stopWatch = (sessionId: string): void => {
    watches.get(sessionId)?.tailer?.stop();
  };

  /** Finds the transcript and starts the tail; every subscriber then gets the backlog. */
  const begin = (sessionId: string): Promise<void> => {
    const current: Watch | undefined = watches.get(sessionId);
    if (current === undefined) return Promise.resolve();
    if (current.starting) return current.starting;
    const starting: Promise<void> = (async (): Promise<void> => {
      const resolved: ResolveTranscriptResult = await resolveTranscript(sessionId);
      const now: Watch | undefined = watches.get(sessionId);
      if (now === undefined) return;
      if (!resolved.ok) {
        put(sessionId, { subscribers: now.subscribers, unavailable: resolved.reason });
        if (now.unavailable !== resolved.reason) {
          sendTo(now.subscribers.values(), {
            type: 'session.chat.unavailable',
            sessionId,
            reason: resolved.reason,
          });
        }
        return;
      }
      const tailer: TranscriptTailer = createTailer(resolved.transcript, (items: ChatItem[]) => {
        const watch: Watch | undefined = watches.get(sessionId);
        if (watch?.tailer !== tailer) return;
        sendTo(watch.subscribers.values(), { type: 'session.chat.items', sessionId, items });
      });
      await tailer.start();
      const after: Watch | undefined = watches.get(sessionId);
      // Everyone left while the backlog was read.
      if (after === undefined) {
        tailer.stop();
        return;
      }
      put(sessionId, {
        subscribers: after.subscribers,
        transcript: resolved.transcript,
        tailer,
      });
      logger?.info('chat tail started', { session: sessionId, path: tailer.path });
      sendTo(after.subscribers.values(), backlogOf(sessionId, resolved.transcript, tailer));
    })()
      .catch((error: unknown): void => {
        logger?.warn('chat tail failed to start', {
          session: sessionId,
          message: error instanceof Error ? error.message : String(error),
        });
        const now: Watch | undefined = watches.get(sessionId);
        if (now) put(sessionId, { subscribers: now.subscribers });
      })
      .finally((): void => {
        const now: Watch | undefined = watches.get(sessionId);
        if (now?.starting) put(sessionId, { ...now, starting: undefined });
      });
    put(sessionId, { ...current, starting });
    return starting;
  };

  const unsubscribe = (sessionId: string, clientId: string): void => {
    const watch: Watch | undefined = watches.get(sessionId);
    if (watch === undefined || !watch.subscribers.has(clientId)) return;
    const subscribers: Map<string, WsClient> = new Map(watch.subscribers);
    subscribers.delete(clientId);
    if (subscribers.size > 0) {
      put(sessionId, { ...watch, subscribers });
      return;
    }
    watch.tailer?.stop();
    put(sessionId, null);
    if (watch.tailer) logger?.info('chat tail stopped', { session: sessionId, why: 'no viewers' });
  };

  /** One-off read of a session nobody watches: a tail started, read and stopped. */
  const readOnce = async (sessionId: string, limit: number): Promise<ChatHistoryResult> => {
    const resolved: ResolveTranscriptResult = await resolveTranscript(sessionId);
    if (!resolved.ok) return { ok: false, reason: resolved.reason };
    const tailer: TranscriptTailer = createTailer(resolved.transcript, (): void => {});
    try {
      await tailer.start();
      return {
        ok: true,
        history: {
          sessionId,
          claudeSessionId: resolved.transcript.claudeSessionId,
          ...tailer.snapshot(limit),
        },
      };
    } finally {
      tailer.stop();
    }
  };

  const transcriptOf = async (sessionId: string): Promise<ResolveTranscriptResult> => {
    const known: ResolvedTranscript | undefined = watches.get(sessionId)?.transcript;
    return known ? { ok: true, transcript: known } : resolveTranscript(sessionId);
  };

  return {
    subscribe: async (sessionId: string, client: WsClient): Promise<void> => {
      const watch: Watch = watches.get(sessionId) ?? { subscribers: new Map() };
      put(sessionId, {
        ...watch,
        subscribers: new Map([...watch.subscribers, [client.id, client]]),
      });
      const ready: Watch | undefined = watches.get(sessionId);
      if (ready?.tailer && ready.transcript) {
        // Anything appended since the last poll first, so the backlog is current.
        await ready.tailer.poll();
        client.send(backlogOf(sessionId, ready.transcript, ready.tailer));
        return;
      }
      if (ready?.unavailable) {
        client.send({ type: 'session.chat.unavailable', sessionId, reason: ready.unavailable });
      }
      await begin(sessionId);
    },

    unsubscribe,

    dropClient: (clientId: string): void => {
      for (const sessionId of [...watches.keys()]) unsubscribe(sessionId, clientId);
    },

    reconcile: async (liveSessions: readonly string[]): Promise<void> => {
      const live: Set<string> = new Set(liveSessions);
      for (const [sessionId, watch] of [...watches]) {
        if (!live.has(sessionId)) {
          // One last read, so the final words reach the screen before "ended".
          await watch.tailer?.poll();
          stopWatch(sessionId);
          put(sessionId, null);
          sendTo(watch.subscribers.values(), { type: 'session.chat.ended', sessionId });
          logger?.info('chat tail stopped', { session: sessionId, why: 'session ended' });
          continue;
        }
        if (!watch.tailer && !watch.starting) await begin(sessionId);
      }
    },

    relink: async (sessionId: string): Promise<void> => {
      const watch: Watch | undefined = watches.get(sessionId);
      if (watch === undefined) return;
      const resolved: ResolveTranscriptResult = await resolveTranscript(sessionId);
      if (resolved.ok && resolved.transcript.path === watch.transcript?.path) return;
      // A new transcript (a /clear, a resume): the old tail stops, the new one sends a backlog.
      watch.tailer?.stop();
      put(sessionId, { subscribers: watch.subscribers });
      await begin(sessionId);
    },

    history: async (sessionId: string, limit: number): Promise<ChatHistoryResult> => {
      const watch: Watch | undefined = watches.get(sessionId);
      if (watch?.tailer && watch.transcript) {
        await watch.tailer.poll();
        return {
          ok: true,
          history: {
            sessionId,
            claudeSessionId: watch.transcript.claudeSessionId,
            ...watch.tailer.snapshot(limit),
          },
        };
      }
      return readOnce(sessionId, limit);
    },

    readItem: async (sessionId: string, itemId: string, ref: string): Promise<ChatItemResult> => {
      const line: LineSource | null = parseRef(ref);
      if (line === null || line.end - line.start > MAX_LINE_BYTES) {
        return { ok: false, reason: 'not-found' };
      }
      const resolved: ResolveTranscriptResult = await transcriptOf(sessionId);
      if (!resolved.ok) return { ok: false, reason: resolved.reason };
      const files = transcriptFiles(resolved.transcript.path);
      const isMain: boolean = line.source === 'main';
      const file: string = isMain
        ? files.main
        : path.join(files.subagentsDir, `agent-${line.source}.jsonl`);
      const meta: SubagentMeta | null = isMain
        ? null
        : parseSubagentMeta(
            await transcripts.readJson(
              path.join(files.subagentsDir, `agent-${line.source}.meta.json`),
            ),
          );
      const bytes: Buffer = await transcripts
        .readRange(file, line.start, line.end - line.start)
        .catch((): Buffer => Buffer.alloc(0));
      const record: TranscriptRecord | null = parseRecord(bytes.toString('utf8'));
      if (record === null) return { ok: false, reason: 'not-found' };
      const ctx: MapContext = {
        toolNames: new Map(),
        limits: FULL_LIMITS,
        line,
        ...(isMain
          ? {}
          : {
              agent: {
                agentId: line.source,
                ...(meta?.toolUseId ? { parentToolUseId: meta.toolUseId } : {}),
              },
            }),
      };
      const item: ChatItem | undefined = recordToItems(record, ctx).find(
        (candidate: ChatItem): boolean => candidate.id === itemId,
      );
      return item ? { ok: true, item } : { ok: false, reason: 'not-found' };
    },

    close: (): void => {
      for (const watch of watches.values()) watch.tailer?.stop();
      watches = new Map();
    },
  };
};
