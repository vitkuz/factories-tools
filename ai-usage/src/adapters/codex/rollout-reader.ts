import fsp from "node:fs/promises";
import path from "node:path";
import type { SourceCursor } from "../../contract/adapter.types.js";
import type { ActorFact, RunFact, UsageEvent } from "../../contract/usage-event.types.js";
import {
  fileExists,
  listFilesRecursive,
  parseJsonLines,
  readFirstLine,
  readLinesFromOffset,
} from "../../shared/utils/fs.utils.js";
import { asNumber, asString, isRecord, nowIso } from "../adapter.utils.js";
import type {
  CodexAdapterSettings,
  CodexRolloutLine,
  CodexRolloutState,
  CodexSessionMeta,
  CodexThreadIndexEntry,
  CodexTokenUsage,
} from "./codex.types.js";
import {
  CODEX_PROVIDER,
  buildCodexEvent,
  codexRunId,
  normalizeCodexUsage,
  resolveRootThread,
  subtractCodexUsage,
  threadActorFact,
  totalOf,
} from "./codex.utils.js";

export const discoverCodexRollouts = async (homeDir: string): Promise<string[]> =>
  (await listFilesRecursive(path.join(homeDir, "sessions"), ".jsonl")).filter(
    (f: string): boolean => path.basename(f).startsWith("rollout-"),
  );

/** Reads only the first line (session_meta) of each rollout to build the thread index. */
export const indexCodexThreads = async (
  files: string[],
): Promise<Map<string, CodexThreadIndexEntry>> => {
  const index: Map<string, CodexThreadIndexEntry> = new Map<string, CodexThreadIndexEntry>();
  for (const file of files) {
    const first: string | null = await readFirstLine(file);
    if (!first) continue;
    const parsed: CodexRolloutLine[] = parseJsonLines<CodexRolloutLine>([first]);
    const line: CodexRolloutLine | undefined = parsed[0];
    if (line?.type !== "session_meta" || !isRecord(line.payload)) continue;
    const meta: CodexSessionMeta = line.payload as CodexSessionMeta;
    if (meta.id) index.set(meta.id, { file, meta });
  }
  return index;
};

const usageFrom = (value: unknown): CodexTokenUsage | undefined =>
  isRecord(value) ? (value as CodexTokenUsage) : undefined;

type FileResult = { events: UsageEvent[]; state: CodexRolloutState; nextOffset: number };

const processRollout = async (
  file: string,
  meta: CodexSessionMeta,
  rootThreadId: string,
  settings: CodexAdapterSettings,
  offset: number,
  prior: CodexRolloutState,
): Promise<FileResult> => {
  const chunk = await readLinesFromOffset(file, offset);
  const lines: CodexRolloutLine[] = parseJsonLines<CodexRolloutLine>(chunk.lines);
  const events: UsageEvent[] = [];
  const state: CodexRolloutState = { ...prior, threadId: meta.id ?? prior.threadId };
  let requestSeq: number = prior.requestSeq ?? 0;
  const isChild: boolean = Boolean(meta.parent_thread_id);

  for (const line of lines) {
    const payload: Record<string, unknown> = isRecord(line.payload) ? line.payload : {};
    if (line.type === "turn_context") {
      const model: string | undefined = asString(payload.model);
      if (model) state.model = model;
      const turnId: string | undefined = asString(payload.turn_id);
      if (turnId) state.turnId = turnId;
      continue;
    }
    if (line.type !== "event_msg") continue;
    const kind: string | undefined = asString(payload.type);
    if (kind === "task_started") {
      const turnId: string | undefined = asString(payload.turn_id);
      if (turnId) state.turnId = turnId;
      continue;
    }
    if (kind !== "token_count" || !isRecord(payload.info)) continue;

    const info: Record<string, unknown> = payload.info;
    const total: CodexTokenUsage | undefined = usageFrom(info.total_token_usage);
    const last: CodexTokenUsage | undefined = usageFrom(info.last_token_usage);
    if (!total || !last) continue;
    const totalTokens: number = totalOf(total);
    const timestamp: string = line.timestamp ?? nowIso();

    // Exact repeat of the running total = duplicate/heartbeat, not a new request.
    if (state.prevTotal !== undefined && totalTokens === state.prevTotal) continue;

    if (state.prevTotal === undefined) {
      // First observation in this thread. Anything already in the running total
      // beyond this request is replayed history (child threads copy parent context).
      const baseline: number = Math.max(0, totalTokens - totalOf(last));
      state.baseline = baseline;
      if (baseline > 0 && isChild) {
        // replayed parent history: excluded from this thread's usage
      }
    }

    const ctx = { billingMode: settings.billingMode, sourcePath: file, meta, rootThreadId };
    requestSeq += 1;
    events.push(
      buildCodexEvent(ctx, {
        usage: normalizeCodexUsage(last, "request"),
        timestamp,
        rawEventId: `token_count#${requestSeq}`,
        keySuffix: `request:${requestSeq}:${totalTokens}`,
        ...(state.turnId ? { turnId: state.turnId } : {}),
        ...(state.model ? { model: state.model } : {}),
      }),
    );
    state.prevTotal = totalTokens;
    state.lastTotal = total;
    state.lastTimestamp = timestamp;
  }
  state.requestSeq = requestSeq;

  // Session-cumulative snapshot for reconciliation: running total minus replayed baseline.
  if (state.lastTotal && state.lastTimestamp) {
    const baselineUsage: CodexTokenUsage =
      state.baseline && state.baseline > 0
        ? {
            input_tokens: state.baseline,
            cached_input_tokens: 0,
            output_tokens: 0,
            reasoning_output_tokens: 0,
            total_tokens: state.baseline,
          }
        : {};
    const net: CodexTokenUsage = subtractCodexUsage(state.lastTotal, baselineUsage);
    const ctx = { billingMode: settings.billingMode, sourcePath: file, meta, rootThreadId };
    events.push(
      buildCodexEvent(ctx, {
        usage: normalizeCodexUsage(net, "session-cumulative"),
        timestamp: state.lastTimestamp,
        rawEventId: "total_token_usage",
        keySuffix: `cumulative:${totalOf(net)}`,
        ...(state.model ? { model: state.model } : {}),
      }),
    );
  }
  return { events, state, nextOffset: chunk.nextOffset };
};

const matchesProject = (cwd: string | undefined, filter: string[] | undefined): boolean =>
  !filter ||
  filter.length === 0 ||
  (cwd !== undefined && filter.some((p: string): boolean => cwd.startsWith(p)));

export const readCodexRollouts = async (
  settings: CodexAdapterSettings,
  cursor: SourceCursor,
): Promise<{
  events: UsageEvent[];
  actors: ActorFact[];
  runs: RunFact[];
  cursor: SourceCursor;
}> => {
  const files: string[] = await discoverCodexRollouts(settings.homeDir);
  const index: Map<string, CodexThreadIndexEntry> = await indexCodexThreads(files);
  const nextCursor: SourceCursor = { ...cursor };
  const events: UsageEvent[] = [];
  const actors: ActorFact[] = [];
  const runs: RunFact[] = [];

  for (const entry of index.values()) {
    const { file, meta } = entry;
    if (!meta.id || !matchesProject(meta.cwd, settings.projectFilter)) continue;
    if (!(await fileExists(file))) continue;
    const rootThreadId: string = resolveRootThread(meta.id, index);
    const fact: ActorFact | null = threadActorFact(meta, rootThreadId);
    if (fact) actors.push(fact);
    if (meta.id === rootThreadId) {
      runs.push({
        runId: codexRunId(rootThreadId),
        provider: CODEX_PROVIDER,
        providerSessionId: rootThreadId,
        ...(meta.cwd ? { project: meta.cwd } : {}),
        ...(meta.timestamp ? { startedAt: meta.timestamp } : {}),
        ...(meta.cli_version ? { providerVersion: meta.cli_version } : {}),
        billingMode: settings.billingMode,
      });
    }
    const size: number = (await fsp.stat(file)).size;
    const offset: number = cursor[file]?.offset ?? 0;
    if (size <= offset) continue;
    const prior: CodexRolloutState = (cursor[file]?.state as CodexRolloutState | undefined) ?? {};
    const result: FileResult = await processRollout(
      file,
      meta,
      rootThreadId,
      settings,
      offset,
      prior,
    );
    events.push(...result.events);
    nextCursor[file] = {
      offset: result.nextOffset,
      state: result.state as Record<string, unknown>,
      updatedAt: nowIso(),
    };
  }
  return { events, actors, runs, cursor: nextCursor };
};

export const readCodexAuthMode = async (
  homeDir: string,
): Promise<"subscription" | "api-payg" | "unknown"> => {
  const authFile: string = path.join(homeDir, "auth.json");
  if (!(await fileExists(authFile))) return "unknown";
  try {
    const raw: unknown = JSON.parse(await fsp.readFile(authFile, "utf8"));
    const mode: unknown = isRecord(raw) ? raw.auth_mode : undefined;
    if (mode === "chatgpt") return "subscription";
    if (
      mode === "apikey" ||
      (isRecord(raw) &&
        typeof raw.OPENAI_API_KEY === "string" &&
        raw.OPENAI_API_KEY.length > 0 &&
        mode !== "chatgpt")
    )
      return "api-payg";
    return "unknown";
  } catch {
    return "unknown";
  }
};

export const _internal = { asNumber };
