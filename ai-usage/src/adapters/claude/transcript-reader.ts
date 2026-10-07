import path from "node:path";
import fsp from "node:fs/promises";
import type { SourceCursor, SourceCursorEntry } from "../../contract/adapter.types.js";
import type { ActorFact, RunFact, UsageEvent } from "../../contract/usage-event.types.js";
import {
  fileExists,
  listFilesRecursive,
  parseJsonLines,
  readLinesFromOffset,
} from "../../shared/utils/fs.utils.js";
import { MAIN_ACTOR_ID } from "../../aggregation/hierarchy.js";
import { nowIso } from "../adapter.utils.js";
import type {
  ClaudeAdapterSettings,
  ClaudeAgentLink,
  ClaudeTranscriptRecord,
} from "./claude.types.js";
import {
  CLAUDE_PROVIDER,
  claudeRunId,
  extractAgentToolResult,
  extractAgentToolUses,
  extractPromptRefs,
  firstUserPromptText,
  linkToActorFact,
  transcriptRecordToEvent,
} from "./claude.utils.js";

export type ClaudeSessionFiles = {
  sessionId: string;
  projectDir: string;
  mainFile: string;
  subagentFiles: string[];
};

const SUBAGENT_FILE = /agent-([a-z0-9]+)\.jsonl$/;

export const discoverClaudeSessions = async (homeDir: string): Promise<ClaudeSessionFiles[]> => {
  const projectsDir: string = path.join(homeDir, "projects");
  const files: string[] = await listFilesRecursive(projectsDir, ".jsonl");
  const mains: string[] = files.filter(
    (f: string): boolean => !f.includes(`${path.sep}subagents${path.sep}`),
  );
  return mains.map((mainFile: string): ClaudeSessionFiles => {
    const sessionId: string = path.basename(mainFile, ".jsonl");
    const sessionDir: string = path.join(path.dirname(mainFile), sessionId, "subagents");
    const subagentFiles: string[] = files.filter(
      (f: string): boolean => f.startsWith(sessionDir + path.sep) && SUBAGENT_FILE.test(f),
    );
    return { sessionId, projectDir: path.dirname(mainFile), mainFile, subagentFiles };
  });
};

type LinkScan = {
  links: Map<string, ClaudeAgentLink>;
  pendingToolUses: Map<
    string,
    { name?: string; description?: string; model?: string; startedAt?: string }
  >;
};

/** Full scan of one transcript for Agent tool_use/tool_result pairs. Cheap relative to usage parsing and immune to ordering. */
const scanLinks = (
  records: ClaudeTranscriptRecord[],
  fileActorId: string,
  scan: LinkScan,
): void => {
  records.forEach((record: ClaudeTranscriptRecord): void => {
    extractAgentToolUses(record).forEach((use): void => {
      scan.pendingToolUses.set(use.toolUseId, {
        ...(use.name ? { name: use.name } : {}),
        ...(use.description ? { description: use.description } : {}),
        ...(use.model ? { model: use.model } : {}),
        ...(record.timestamp ? { startedAt: record.timestamp } : {}),
      });
    });
    const result = extractAgentToolResult(record);
    if (result) {
      const pending = result.toolUseId ? scan.pendingToolUses.get(result.toolUseId) : undefined;
      scan.links.set(result.agentId, {
        agentId: result.agentId,
        parentActorId: fileActorId,
        name: pending?.name ?? "agent",
        ...(pending?.description ? { description: pending.description } : {}),
        ...((result.resolvedModel ?? pending?.model)
          ? { model: result.resolvedModel ?? pending?.model }
          : {}),
        ...(pending?.startedAt ? { startedAt: pending.startedAt } : {}),
      });
    }
  });
};

const fileActorIdOf = (file: string): string => {
  const match: RegExpMatchArray | null = file.match(SUBAGENT_FILE);
  return match?.[1] ?? MAIN_ACTOR_ID;
};

const readAll = async (file: string): Promise<ClaudeTranscriptRecord[]> => {
  const chunk = await readLinesFromOffset(file, 0);
  return parseJsonLines<ClaudeTranscriptRecord>(chunk.lines);
};

const matchesProject = (cwd: string | undefined, filter: string[] | undefined): boolean =>
  !filter ||
  filter.length === 0 ||
  (cwd !== undefined && filter.some((p: string): boolean => cwd.startsWith(p)));

export type ClaudeReadResult = {
  events: UsageEvent[];
  actors: ActorFact[];
  runs: RunFact[];
  cursor: SourceCursor;
};

export const readClaudeTranscripts = async (
  settings: ClaudeAdapterSettings,
  cursor: SourceCursor,
): Promise<ClaudeReadResult> => {
  const sessions: ClaudeSessionFiles[] = await discoverClaudeSessions(settings.homeDir);
  const nextCursor: SourceCursor = { ...cursor };
  const events: UsageEvent[] = [];
  const actors: ActorFact[] = [];
  const runs: RunFact[] = [];

  for (const session of sessions) {
    const allFiles: string[] = [session.mainFile, ...session.subagentFiles];
    const changed: boolean[] = await Promise.all(
      allFiles.map(async (f: string): Promise<boolean> => {
        if (!(await fileExists(f))) return false;
        const size: number = (await fsp.stat(f)).size;
        return size > (cursor[f]?.offset ?? 0);
      }),
    );
    if (!changed.some(Boolean)) continue;

    // Phase 1: hierarchy links from every file of the session (full scan).
    const scan: LinkScan = {
      links: new Map<string, ClaudeAgentLink>(),
      pendingToolUses: new Map(),
    };
    const fullRecords: Map<string, ClaudeTranscriptRecord[]> = new Map<
      string,
      ClaudeTranscriptRecord[]
    >();
    for (const file of allFiles) {
      const records: ClaudeTranscriptRecord[] = await readAll(file);
      fullRecords.set(file, records);
      scanLinks(records, fileActorIdOf(file), scan);
    }
    scan.links.forEach((link: ClaudeAgentLink): void => {
      const agentFile: string | undefined = allFiles.find(
        (f: string): boolean => fileActorIdOf(f) === link.agentId,
      );
      const records: ClaudeTranscriptRecord[] = agentFile ? (fullRecords.get(agentFile) ?? []) : [];
      const timestamps: string[] = records
        .map((r: ClaudeTranscriptRecord): string => r.timestamp ?? "")
        .filter(Boolean)
        .sort();
      const refs: string[] = extractPromptRefs(firstUserPromptText(records));
      const enriched: ClaudeAgentLink = {
        ...link,
        ...(!link.startedAt && timestamps[0] ? { startedAt: timestamps[0] } : {}),
        ...(timestamps[timestamps.length - 1]
          ? { endedAt: timestamps[timestamps.length - 1] }
          : {}),
        ...(refs.length > 0 ? { refs } : {}),
      };
      actors.push(linkToActorFact(session.sessionId, enriched));
    });

    // Phase 2: incremental usage from each file offset.
    let runRecorded = false;
    for (const file of allFiles) {
      const offset: number = cursor[file]?.offset ?? 0;
      const chunk = await readLinesFromOffset(file, offset);
      const records: ClaudeTranscriptRecord[] = parseJsonLines<ClaudeTranscriptRecord>(chunk.lines);
      const fileActorId: string = fileActorIdOf(file);
      const fileEvents: UsageEvent[] = records
        .filter((r: ClaudeTranscriptRecord): boolean =>
          matchesProject(r.cwd, settings.projectFilter),
        )
        .flatMap((r: ClaudeTranscriptRecord): UsageEvent[] => {
          const e: UsageEvent | null = transcriptRecordToEvent(r, {
            billingMode: settings.billingMode,
            sourcePath: file,
            fileActorId,
            links: scan.links,
          });
          return e ? [e] : [];
        });
      events.push(...fileEvents);
      const entry: SourceCursorEntry = { offset: chunk.nextOffset, updatedAt: nowIso() };
      nextCursor[file] = entry;

      if (!runRecorded) {
        const first: ClaudeTranscriptRecord | undefined = (fullRecords.get(file) ?? []).find(
          (r: ClaudeTranscriptRecord): boolean =>
            r.sessionId !== undefined && r.timestamp !== undefined,
        );
        if (first?.sessionId) {
          runs.push({
            runId: claudeRunId(first.sessionId),
            provider: CLAUDE_PROVIDER,
            providerSessionId: first.sessionId,
            ...(first.cwd ? { project: first.cwd } : {}),
            ...(first.timestamp ? { startedAt: first.timestamp } : {}),
            ...(first.version ? { providerVersion: first.version } : {}),
            billingMode: settings.billingMode,
          });
          runRecorded = true;
        }
      }
    }
  }
  return { events, actors, runs, cursor: nextCursor };
};
