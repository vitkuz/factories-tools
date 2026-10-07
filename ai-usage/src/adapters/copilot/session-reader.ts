import path from "node:path";
import type { SourceCursor } from "../../contract/adapter.types.js";
import type { ActorFact, RunFact, UsageEvent } from "../../contract/usage-event.types.js";
import { fileExists, readJsonl } from "../../shared/utils/fs.utils.js";
import { createSqliteQuery, type SqliteQuery } from "../sqlite/python-sqlite.adapter.js";
import { nowIso } from "../adapter.utils.js";
import type {
  CopilotAdapterSettings,
  CopilotSessionEvent,
  CopilotSessionRow,
  CopilotSubagentInfo,
  CopilotUsageRow,
} from "./copilot.types.js";
import {
  COPILOT_PROVIDER,
  checkpointToEvent,
  copilotRunId,
  extractSubagents,
  extractUsageCheckpoint,
  subagentToActorFact,
  usageRowToEvent,
} from "./copilot.utils.js";

const USAGE_SOURCE = "session-store.db#assistant_usage_events";

const SELECT_ROWS = `
  SELECT id, session_id, turn_index, agent_id, parent_tool_call_id, model,
         input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
         total_nano_aiu, request_multiplier, initiator, api_endpoint, reasoning_effort, created_at
  FROM assistant_usage_events WHERE id > ? ORDER BY id ASC`;

const SELECT_SESSIONS = `SELECT id, cwd, repository, created_at FROM sessions WHERE id IN (%IDS%)`;

const matchesProject = (cwd: string | null | undefined, filter: string[] | undefined): boolean =>
  !filter ||
  filter.length === 0 ||
  (typeof cwd === "string" && filter.some((p: string): boolean => cwd.startsWith(p)));

export const readCopilotSessions = async (
  settings: CopilotAdapterSettings,
  cursor: SourceCursor,
): Promise<{
  events: UsageEvent[];
  actors: ActorFact[];
  runs: RunFact[];
  cursor: SourceCursor;
}> => {
  const dbPath: string = path.join(settings.homeDir, "session-store.db");
  const empty = { events: [], actors: [], runs: [], cursor };
  if (!settings.query && !(await fileExists(dbPath))) return empty;
  const query: SqliteQuery =
    settings.query ?? createSqliteQuery({ pythonBin: settings.pythonBin, dbPath });

  const lastRowId: number = cursor[USAGE_SOURCE]?.lastRowId ?? 0;
  const rows: CopilotUsageRow[] = (await query(SELECT_ROWS, [
    lastRowId,
  ])) as unknown as CopilotUsageRow[];
  if (rows.length === 0) return empty;

  const sessionIds: string[] = Array.from(
    new Set<string>(rows.map((r: CopilotUsageRow): string => r.session_id)),
  );
  const placeholders: string = sessionIds.map((): string => "?").join(",");
  const sessions: CopilotSessionRow[] = (await query(
    SELECT_SESSIONS.replace("%IDS%", placeholders),
    sessionIds,
  )) as unknown as CopilotSessionRow[];
  const sessionById: Map<string, CopilotSessionRow> = new Map<string, CopilotSessionRow>(
    sessions.map((s: CopilotSessionRow): [string, CopilotSessionRow] => [s.id, s]),
  );

  const events: UsageEvent[] = [];
  const actors: ActorFact[] = [];
  const runs: RunFact[] = [];
  const nextCursor: SourceCursor = { ...cursor };

  for (const sessionId of sessionIds) {
    const session: CopilotSessionRow | undefined = sessionById.get(sessionId);
    if (!matchesProject(session?.cwd, settings.projectFilter)) continue;
    const eventsFile: string = path.join(
      settings.homeDir,
      "session-state",
      sessionId,
      "events.jsonl",
    );
    const sessionEvents: CopilotSessionEvent[] = (await fileExists(eventsFile))
      ? await readJsonl<CopilotSessionEvent>(eventsFile)
      : [];
    const subagents: Map<string, CopilotSubagentInfo> = extractSubagents(sessionEvents);
    const project: string | undefined = session?.cwd ?? undefined;
    const ctx = {
      billingMode: settings.billingMode,
      sourcePath: dbPath,
      ...(project ? { project } : {}),
      subagents,
    };

    new Set<CopilotSubagentInfo>(subagents.values()).forEach((info: CopilotSubagentInfo): void => {
      actors.push(subagentToActorFact(sessionId, info));
    });
    rows
      .filter((r: CopilotUsageRow): boolean => r.session_id === sessionId)
      .forEach((r: CopilotUsageRow): void => {
        events.push(usageRowToEvent(r, ctx));
      });
    const checkpoint = extractUsageCheckpoint(sessionEvents);
    if (checkpoint)
      events.push(checkpointToEvent(sessionId, checkpoint, { ...ctx, sourcePath: eventsFile }));

    const start: CopilotSessionEvent | undefined = sessionEvents.find(
      (e: CopilotSessionEvent): boolean => e.type === "session.start",
    );
    const copilotVersion: unknown = start?.data?.copilotVersion;
    runs.push({
      runId: copilotRunId(sessionId),
      provider: COPILOT_PROVIDER,
      providerSessionId: sessionId,
      ...(project ? { project } : {}),
      ...((start?.timestamp ?? session?.created_at)
        ? { startedAt: (start?.timestamp ?? session?.created_at) as string }
        : {}),
      ...(typeof copilotVersion === "string" ? { providerVersion: copilotVersion } : {}),
      billingMode: settings.billingMode,
    });
  }

  const maxId: number = rows.reduce(
    (acc: number, r: CopilotUsageRow): number => Math.max(acc, r.id),
    lastRowId,
  );
  nextCursor[USAGE_SOURCE] = { lastRowId: maxId, updatedAt: nowIso() };
  return { events, actors, runs, cursor: nextCursor };
};
