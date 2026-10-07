import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { SourceCursor } from "../../contract/adapter.types.js";
import type { ActorFact, RunFact, UsageEvent } from "../../contract/usage-event.types.js";
import { fileExists } from "../../shared/utils/fs.utils.js";
import { nowIso } from "../adapter.utils.js";
import type { AntigravityAdapterSettings, AntigravityConversation } from "./antigravity.types.js";
import {
  conversationToActorFact,
  conversationToRunFact,
  generationToEvent,
  resolveRoot,
} from "./antigravity.utils.js";

const execFileAsync = promisify(execFile);
const here: string = path.dirname(fileURLToPath(import.meta.url));
const DECODER: string = path.join(here, "decode-conversations.py");

export const decodeWithPython =
  (pythonBin: string) =>
  async (files: string[]): Promise<AntigravityConversation[]> => {
    if (files.length === 0) return [];
    const { stdout } = await execFileAsync(pythonBin, [DECODER, ...files], {
      maxBuffer: 512 * 1024 * 1024,
    });
    return JSON.parse(stdout) as AntigravityConversation[];
  };

export const discoverAntigravityConversations = async (homeDir: string): Promise<string[]> => {
  const dir: string = path.join(homeDir, "conversations");
  if (!(await fileExists(dir))) return [];
  return (await fsp.readdir(dir))
    .filter((f: string): boolean => f.endsWith(".db"))
    .map((f: string): string => path.join(dir, f))
    .sort();
};

const matchesProject = (
  project: string | null | undefined,
  filter: string[] | undefined,
): boolean =>
  !filter ||
  filter.length === 0 ||
  (typeof project === "string" && filter.some((p: string): boolean => project.startsWith(p)));

/**
 * Every conversation is one SQLite file that Antigravity keeps rewriting while it runs, so the cursor is a
 * size+mtime fingerprint per file. All files are decoded for hierarchy (a child names its root), but only
 * changed files emit events; duplicates die on eventKey anyway.
 */
export const readAntigravityConversations = async (
  settings: AntigravityAdapterSettings,
  cursor: SourceCursor,
): Promise<{
  events: UsageEvent[];
  actors: ActorFact[];
  runs: RunFact[];
  cursor: SourceCursor;
}> => {
  const files: string[] = await discoverAntigravityConversations(settings.homeDir);
  const decode = settings.decode ?? decodeWithPython(settings.pythonBin);
  const fingerprints: Map<string, number> = new Map<string, number>();
  for (const file of files) {
    const stat = await fsp.stat(file);
    fingerprints.set(file, stat.size + stat.mtimeMs);
  }
  const changed: string[] = files.filter(
    (f: string): boolean => cursor[f]?.offset !== fingerprints.get(f),
  );
  if (changed.length === 0) return { events: [], actors: [], runs: [], cursor };

  const conversations: AntigravityConversation[] = await decode(files);
  const byId: Map<string, AntigravityConversation> = new Map<string, AntigravityConversation>(
    conversations.map((c): [string, AntigravityConversation] => [c.id, c]),
  );
  const events: UsageEvent[] = [];
  const actors: ActorFact[] = [];
  const runs: RunFact[] = [];
  const nextCursor: SourceCursor = { ...cursor };

  conversations.forEach((c: AntigravityConversation, i: number): void => {
    const file: string = files[i] as string;
    const rootId: string = resolveRoot(c.id, byId);
    const root: AntigravityConversation | undefined = byId.get(rootId);
    if (!matchesProject(c.workspace ?? root?.workspace, settings.projectFilter)) return;
    const fact: ActorFact | null = conversationToActorFact(c, rootId);
    if (fact) actors.push(fact);
    if (c.id === rootId) runs.push(conversationToRunFact(c, settings.billingMode));
    if (!changed.includes(file)) return;
    c.generations.forEach((g): void => {
      events.push(
        generationToEvent({ ...c, workspace: c.workspace ?? root?.workspace ?? null }, g, {
          rootId,
          billingMode: settings.billingMode,
          sourcePath: file,
        }),
      );
    });
    nextCursor[file] = { offset: fingerprints.get(file) as number, updatedAt: nowIso() };
  });
  return { events, actors, runs, cursor: nextCursor };
};
