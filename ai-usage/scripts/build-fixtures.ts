/**
 * Builds sanitized fixtures from the real local telemetry of the three CLIs.
 * Only structural/usage fields are kept; prompt and response text is dropped.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const HOME: string = os.homedir();
const OUT: string = path.resolve("fixtures");
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const readJsonl = async (p: string): Promise<Record<string, unknown>[]> =>
  (await fsp.readFile(p, "utf8"))
    .split("\n")
    .filter((l: string): boolean => l.trim() !== "")
    .flatMap((l: string): Record<string, unknown>[] => {
      try {
        const v: unknown = JSON.parse(l);
        return isRecord(v) ? [v] : [];
      } catch {
        return [];
      }
    });

const writeJsonl = async (p: string, rows: unknown[]): Promise<void> => {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, rows.map((r: unknown): string => JSON.stringify(r)).join("\n") + "\n");
};

// ---------------- Claude ----------------
const scrubClaudeRecord = (r: Record<string, unknown>): Record<string, unknown> | null => {
  if (r.type !== "assistant" && r.type !== "user") return null;
  const message: Record<string, unknown> = isRecord(r.message) ? r.message : {};
  const content: unknown[] = Array.isArray(message.content) ? message.content : [];
  const keptContent: unknown[] = content.flatMap((b: unknown): unknown[] => {
    if (!isRecord(b)) return [];
    if (b.type === "tool_use" && b.name === "Agent") {
      const input: Record<string, unknown> = isRecord(b.input) ? b.input : {};
      return [
        {
          type: "tool_use",
          id: b.id,
          name: "Agent",
          input: {
            subagent_type: input.subagent_type,
            description: input.description,
            model: input.model ?? null,
          },
        },
      ];
    }
    if (b.type === "tool_result") return [{ type: "tool_result", tool_use_id: b.tool_use_id }];
    return [];
  });
  const toolUseResult: unknown =
    isRecord(r.toolUseResult) && typeof r.toolUseResult.agentId === "string"
      ? {
          agentId: r.toolUseResult.agentId,
          resolvedModel: r.toolUseResult.resolvedModel,
          status: r.toolUseResult.status,
        }
      : undefined;
  if (r.type === "user" && !toolUseResult) return null;
  return {
    type: r.type,
    uuid: r.uuid,
    parentUuid: r.parentUuid,
    sessionId: r.sessionId,
    requestId: r.requestId,
    isSidechain: r.isSidechain,
    agentId: r.agentId ?? null,
    cwd: "/fixtures/claude-project",
    version: r.version,
    timestamp: r.timestamp,
    apiBlockIndex: r.apiBlockIndex,
    message: {
      id: message.id,
      model: message.model,
      role: message.role,
      content: keptContent,
      ...(message.usage ? { usage: message.usage } : {}),
    },
    ...(toolUseResult ? { toolUseResult } : {}),
  };
};

const buildClaude = async (): Promise<void> => {
  // Your own Claude project folder (the project path with "/" replaced by "-"), e.g. -home-you-my-project
  const projectDir: string = path.join(HOME, ".claude/projects/-home-you-my-project");
  const sessionId = "a8a914a0-98fd-40bf-bb83-8b36b12373df";
  const outProject: string = path.join(
    OUT,
    "claude/nested-subagents/projects/-fixtures-claude-project",
  );
  const main: Record<string, unknown>[] = await readJsonl(
    path.join(projectDir, `${sessionId}.jsonl`),
  );
  await writeJsonl(
    path.join(outProject, `${sessionId}.jsonl`),
    main.map(scrubClaudeRecord).filter(Boolean),
  );
  const subDir: string = path.join(projectDir, sessionId, "subagents");
  const files: string[] = (await fsp.readdir(subDir)).filter((f: string): boolean =>
    f.endsWith(".jsonl"),
  );
  for (const f of files) {
    const rows: Record<string, unknown>[] = await readJsonl(path.join(subDir, f));
    await writeJsonl(
      path.join(outProject, sessionId, "subagents", f),
      rows.map(scrubClaudeRecord).filter(Boolean),
    );
  }
  // A `claude -p --output-format json` result captured on your machine; point the env var at it.
  const headlessSample: string =
    process.env["AI_USAGE_HEADLESS_SAMPLE"] ?? "/path/to/your/claude-p.json";
  const headless: Record<string, unknown> = JSON.parse(await fsp.readFile(headlessSample, "utf8"));
  await fsp.mkdir(path.join(OUT, "claude/headless"), { recursive: true });
  await fsp.writeFile(
    path.join(OUT, "claude/headless/result.json"),
    JSON.stringify({ ...headless, result: "OK", uuid: undefined, permission_denials: [] }, null, 2),
  );
  console.log("claude fixture:", files.length, "subagent files");
};

// ---------------- Codex ----------------
const scrubCodexLine = (r: Record<string, unknown>): Record<string, unknown> | null => {
  const payload: Record<string, unknown> = isRecord(r.payload) ? r.payload : {};
  if (r.type === "session_meta") {
    return {
      timestamp: r.timestamp,
      type: "session_meta",
      payload: {
        id: payload.id,
        timestamp: payload.timestamp,
        cwd: "/fixtures/codex-project",
        originator: payload.originator,
        cli_version: payload.cli_version,
        source: payload.source,
        model_provider: payload.model_provider ?? null,
        parent_thread_id: null,
        forked_from_id: null,
      },
    };
  }
  if (r.type === "turn_context")
    return {
      timestamp: r.timestamp,
      type: "turn_context",
      payload: { cwd: "/fixtures/codex-project", model: payload.model, turn_id: payload.turn_id },
    };
  if (r.type === "event_msg") {
    if (payload.type === "token_count")
      return {
        timestamp: r.timestamp,
        type: "event_msg",
        payload: { type: "token_count", info: payload.info ?? null, rate_limits: null },
      };
    if (payload.type === "task_started" || payload.type === "task_complete")
      return {
        timestamp: r.timestamp,
        type: "event_msg",
        payload: { type: payload.type, turn_id: payload.turn_id },
      };
  }
  return null;
};

const buildCodex = async (): Promise<void> => {
  const src: string = path.join(
    HOME,
    ".codex/sessions/2026/05/03/rollout-2026-05-03T00-09-04-019dea4f-13fb-7040-a78d-b7d50c0683fb.jsonl",
  );
  const rows: Record<string, unknown>[] = (await readJsonl(src))
    .map(scrubCodexLine)
    .filter((r): r is Record<string, unknown> => r !== null);
  const rel =
    "sessions/2026/05/03/rollout-2026-05-03T00-09-04-019dea4f-13fb-7040-a78d-b7d50c0683fb.jsonl";
  await writeJsonl(path.join(OUT, "codex/basic", rel), rows);
  await writeJsonl(path.join(OUT, "codex/replay", rel), rows);

  // Synthetic child thread: replays the parent's cumulative history, then does 2 requests of its own.
  const lastTotal = [...rows]
    .reverse()
    .find(
      (r) => isRecord(r.payload) && r.payload.type === "token_count" && isRecord(r.payload.info),
    );
  const parentTotal = (
    lastTotal as { payload: { info: { total_token_usage: Record<string, number> } } }
  ).payload.info.total_token_usage;
  const childId = "019dea99-0000-7000-8000-000000000001";
  const req1 = {
    input_tokens: 12000,
    cached_input_tokens: 8000,
    output_tokens: 300,
    reasoning_output_tokens: 20,
    total_tokens: 12300,
  };
  const req2 = {
    input_tokens: 14000,
    cached_input_tokens: 11000,
    output_tokens: 500,
    reasoning_output_tokens: 40,
    total_tokens: 14500,
  };
  const add = (a: Record<string, number>, b: Record<string, number>): Record<string, number> =>
    Object.fromEntries(
      Object.keys(b).map((k: string): [string, number] => [k, (a[k] ?? 0) + (b[k] ?? 0)]),
    );
  const t1 = add(parentTotal, req1);
  const t2 = add(t1, req2);
  const child: Record<string, unknown>[] = [
    {
      timestamp: "2026-05-02T20:30:00.000Z",
      type: "session_meta",
      payload: {
        id: childId,
        timestamp: "2026-05-02T20:30:00.000Z",
        cwd: "/fixtures/codex-project",
        originator: "codex-tui",
        cli_version: "0.128.0",
        source: "subagent",
        model_provider: "openai",
        parent_thread_id: "019dea4f-13fb-7040-a78d-b7d50c0683fb",
        forked_from_id: null,
        depth: 1,
        nickname: "scout",
        role: "explorer",
      },
    },
    {
      timestamp: "2026-05-02T20:30:01.000Z",
      type: "turn_context",
      payload: {
        cwd: "/fixtures/codex-project",
        model: "gpt-5.5",
        turn_id: "019dea99-0000-7000-8000-00000000aaaa",
      },
    },
    {
      timestamp: "2026-05-02T20:30:01.000Z",
      type: "event_msg",
      payload: { type: "task_started", turn_id: "019dea99-0000-7000-8000-00000000aaaa" },
    },
    {
      timestamp: "2026-05-02T20:30:05.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { total_token_usage: t1, last_token_usage: req1, model_context_window: 258400 },
        rate_limits: null,
      },
    },
    {
      timestamp: "2026-05-02T20:30:05.500Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { total_token_usage: t1, last_token_usage: req1, model_context_window: 258400 },
        rate_limits: null,
      },
    },
    {
      timestamp: "2026-05-02T20:30:09.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { total_token_usage: t2, last_token_usage: req2, model_context_window: 258400 },
        rate_limits: null,
      },
    },
    {
      timestamp: "2026-05-02T20:30:10.000Z",
      type: "event_msg",
      payload: { type: "task_complete", turn_id: "019dea99-0000-7000-8000-00000000aaaa" },
    },
  ];
  await writeJsonl(
    path.join(
      OUT,
      "codex/replay/sessions/2026/05/03/rollout-2026-05-03T00-30-00-" + childId + ".jsonl",
    ),
    child,
  );
  await fsp.writeFile(
    path.join(OUT, "codex/replay/expected.json"),
    JSON.stringify(
      {
        parentTotal: parentTotal.total_tokens,
        childOwn: req1.total_tokens + req2.total_tokens,
        replayedBaseline: parentTotal.total_tokens,
      },
      null,
      2,
    ),
  );
  console.log("codex fixture: parent total", parentTotal.total_tokens);
};

// ---------------- Copilot ----------------
const buildCopilot = async (): Promise<void> => {
  const sessionId = "2f80d15c-4950-49d0-8973-613decb5fb3a";
  const py = `
import sqlite3, json, sys
db = sqlite3.connect("file:${path.join(HOME, ".copilot/session-store.db")}?mode=ro", uri=True); db.row_factory = sqlite3.Row
cols = "id, session_id, turn_index, agent_id, parent_tool_call_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, total_nano_aiu, request_multiplier, initiator, api_endpoint, reasoning_effort, created_at"
rows = [dict(r) for r in db.execute(f"select {cols} from assistant_usage_events where session_id=? order by id", ("${sessionId}",))]
sessions = [dict(r) for r in db.execute("select id, cwd, repository, created_at from sessions where id=?", ("${sessionId}",))]
print(json.dumps({"rows": rows, "sessions": sessions}))`;
  const data = JSON.parse(execFileSync("python3", ["-c", py]).toString()) as {
    rows: Record<string, unknown>[];
    sessions: Record<string, unknown>[];
  };
  const out: string = path.join(OUT, "copilot/subagents");
  await fsp.mkdir(path.join(out, "session-state", sessionId), { recursive: true });
  await fsp.writeFile(path.join(out, "usage-rows.json"), JSON.stringify(data.rows, null, 1));
  await fsp.writeFile(
    path.join(out, "sessions.json"),
    JSON.stringify(
      data.sessions.map((s) => ({
        ...s,
        cwd: "/fixtures/copilot-project",
        repository: "fixtures/copilot",
      })),
      null,
      1,
    ),
  );
  const events: Record<string, unknown>[] = await readJsonl(
    path.join(HOME, ".copilot/session-state", sessionId, "events.jsonl"),
  );
  const kept: Record<string, unknown>[] = events.flatMap((e): Record<string, unknown>[] => {
    const d: Record<string, unknown> = isRecord(e.data) ? e.data : {};
    if (e.type === "session.start")
      return [
        {
          type: e.type,
          id: e.id,
          timestamp: e.timestamp,
          parentId: null,
          data: {
            sessionId: d.sessionId,
            copilotVersion: d.copilotVersion,
            startTime: d.startTime,
          },
        },
      ];
    if (e.type === "subagent.started")
      return [
        {
          type: e.type,
          id: e.id,
          timestamp: e.timestamp,
          agentId: e.agentId,
          data: {
            toolCallId: d.toolCallId,
            agentName: d.agentName,
            agentDisplayName: d.agentDisplayName,
            model: d.model,
          },
        },
      ];
    if (e.type === "subagent.completed")
      return [
        {
          type: e.type,
          id: e.id,
          timestamp: e.timestamp,
          agentId: e.agentId,
          data: {
            toolCallId: d.toolCallId,
            agentName: d.agentName,
            agentDisplayName: d.agentDisplayName,
            model: d.model,
            totalTokens: d.totalTokens,
            totalToolCalls: d.totalToolCalls,
          },
        },
      ];
    if (e.type === "session.usage_checkpoint")
      return [
        {
          type: e.type,
          id: e.id,
          timestamp: e.timestamp,
          data: { totalNanoAiu: d.totalNanoAiu, totalPremiumRequests: d.totalPremiumRequests },
        },
      ];
    return [];
  });
  await writeJsonl(path.join(out, "session-state", sessionId, "events.jsonl"), kept);
  console.log("copilot fixture:", data.rows.length, "rows,", kept.length, "events");
};

await buildClaude();
await buildCodex();
await buildCopilot();
