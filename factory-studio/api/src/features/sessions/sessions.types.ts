import type { z } from 'zod';
import type { ParamValue } from '../pipelines/pipelines.types.js';
import type {
  harnessSchema,
  replySessionPayloadSchema,
  sessionMetaSchema,
  sessionStatusSchema,
  startSessionPayloadSchema,
  stopSessionPayloadSchema,
} from './sessions.schema.js';

export type Harness = z.infer<typeof harnessSchema>;
export type StartSessionPayload = z.infer<typeof startSessionPayloadSchema>;
export type StopSessionPayload = z.infer<typeof stopSessionPayloadSchema>;
export type ReplySessionPayload = z.infer<typeof replySessionPayloadSchema>;
export type SessionMeta = z.infer<typeof sessionMetaSchema>;
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

/** One running factory, as `GET /sessions` reports it. */
export interface FactorySession {
  /** Session name, also the herdr workspace label: `factory-<id without -factory>-<short uuid>`. */
  session: string;
  /** The skill id the run was started with, e.g. `canonical-factory`. */
  factoryId: string;
  /** `unknown` when the session carries no label: started by hand, or by an older build. */
  harness: Harness | 'unknown';
  startedAt: string;
  ageSeconds: number;
  /** Human form of `ageSeconds`: `4m`, `2h 14m`, `1d 3h`. */
  age: string;
  /** herdr's agent status for the session's pane. */
  status?: SessionStatus;
  workspaceId?: string;
  paneId?: string;
}

/** A param as it goes on the command line: its name and its value, coerced to the default's type. */
export type ResolvedParam = readonly [string, ParamValue];

/** One refusal of a start's params, shaped like a zod issue so the app lists it the same way. */
export interface ParamIssue {
  path: string[];
  message: string;
}

export type ResolveParamsResult =
  { ok: true; params: ResolvedParam[] } | { ok: false; issues: ParamIssue[] };

export interface StartedRun {
  session: string;
  factoryId: string;
  harness: Harness;
  /** The whole prompt the harness received: `/<id> name=value ...` or `/<id> <prompt>`. */
  prompt: string;
  promptFile: string;
  workDir: string;
}

export type StartFactoryResult =
  | { ok: true; run: StartedRun }
  /** `id` is not a pipeline skill on disk. `available` is what is. */
  | { ok: false; reason: 'unknown-factory'; available: string[] }
  /** The params do not fit the factory's `pipeline.json`: unknown, of the wrong type, or missing. */
  | { ok: false; reason: 'invalid-params'; issues: ParamIssue[] }
  /** The session was created and was gone again inside the grace period. */
  | { ok: false; reason: 'exited-immediately'; session: string; harness: Harness };

export type StopSessionResult =
  | { ok: true; stopped: FactorySession }
  | { ok: false; reason: 'not-found'; running: string[] }
  /** The target was a factory id with more than one live session. */
  | { ok: false; reason: 'ambiguous'; sessions: FactorySession[] };

export interface StartSessionArgs {
  session: string;
  factoryId: string;
  harness: Harness;
  /** The shell command the session runs. Built by `build-harness-command`. */
  command: string;
  workDir: string;
  /** Environment the session's processes get: the question hook finds the API through it. */
  env: Readonly<Record<string, string>>;
}

export type ReplySessionResult = { ok: true } | { ok: false; reason: 'not-found' };

/** What `server.ts` hands the routes. */
export interface SessionUsecases {
  startFactorySession: (payload: StartSessionPayload) => Promise<StartFactoryResult>;
  listSessions: () => Promise<FactorySession[]>;
  stopSession: (target: string) => Promise<StopSessionResult>;
  /** Types `text` and Enter into the pane of the session named `sessionId`. */
  replySession: (sessionId: string, text: string) => Promise<ReplySessionResult>;
}
