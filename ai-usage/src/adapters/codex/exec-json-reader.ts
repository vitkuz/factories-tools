import type { BillingMode, UsageEvent } from "../../contract/usage-event.types.js";
import { parseJsonLines } from "../../shared/utils/fs.utils.js";
import { asString, isRecord } from "../adapter.utils.js";
import type { CodexTokenUsage } from "./codex.types.js";
import { buildCodexEvent, normalizeCodexUsage } from "./codex.utils.js";

/**
 * `codex exec --json` stdout: thread.started / turn.started / item.* / turn.completed{usage}.
 * Each turn.completed is turn-scoped usage for the thread. Rollout files remain the primary source;
 * this reader exists for pipelines that only keep the exec output.
 */
export const parseCodexExecJsonl = (
  lines: string[],
  opts: {
    billingMode: BillingMode;
    sourcePath: string;
    timestamp: string;
    model?: string;
    project?: string;
  },
): UsageEvent[] => {
  const records: Record<string, unknown>[] = parseJsonLines<unknown>(lines).filter(isRecord);
  const threadId: string | undefined = records
    .map((r: Record<string, unknown>): string | undefined =>
      r.type === "thread.started" ? asString(r.thread_id) : undefined,
    )
    .find((v: string | undefined): boolean => v !== undefined);
  if (!threadId) return [];
  const meta = { id: threadId, ...(opts.project ? { cwd: opts.project } : {}) };
  const ctx = {
    billingMode: opts.billingMode,
    sourcePath: opts.sourcePath,
    meta,
    rootThreadId: threadId,
  };
  return records.flatMap((r: Record<string, unknown>, i: number): UsageEvent[] => {
    if (r.type !== "turn.completed" || !isRecord(r.usage)) return [];
    const usage: CodexTokenUsage = r.usage as CodexTokenUsage;
    return [
      buildCodexEvent(ctx, {
        usage: normalizeCodexUsage(usage, "turn"),
        timestamp: opts.timestamp,
        rawEventId: `turn.completed#${i}`,
        keySuffix: `exec-turn:${i}`,
        ...(opts.model ? { model: opts.model } : {}),
      }),
    ];
  });
};
