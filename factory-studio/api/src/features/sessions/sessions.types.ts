import type { z } from 'zod';
import type {
  harnessSchema,
  startSessionPayloadSchema,
  stopSessionPayloadSchema,
} from './sessions.schema.js';

export type Harness = z.infer<typeof harnessSchema>;
export type StartSessionPayload = z.infer<typeof startSessionPayloadSchema>;
export type StopSessionPayload = z.infer<typeof stopSessionPayloadSchema>;

/** One running factory, as `GET /sessions` reports it. */
export interface FactorySession {
  /** tmux session name: `factory-<id without -factory>-<short uuid>`. */
  session: string;
  /** The skill id the run was started with, e.g. `canonical-factory`. */
  factoryId: string;
  /** `unknown` when the session carries no label: started by hand, or by an older build. */
  harness: Harness | 'unknown';
  startedAt: string;
  ageSeconds: number;
  /** Human form of `ageSeconds`: `4m`, `2h 14m`, `1d 3h`. */
  age: string;
}

export interface StartedRun {
  session: string;
  factoryId: string;
  harness: Harness;
  /** The whole prompt the harness received: `/<id> <prompt>`. */
  prompt: string;
  promptFile: string;
  workDir: string;
}

export type StartFactoryResult =
  | { ok: true; run: StartedRun }
  /** `id` is not a pipeline skill on disk. `available` is what is. */
  | { ok: false; reason: 'unknown-factory'; available: string[] }
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
}

/** What `server.ts` hands the routes. */
export interface SessionUsecases {
  startFactorySession: (payload: StartSessionPayload) => Promise<StartFactoryResult>;
  listSessions: () => Promise<FactorySession[]>;
  stopSession: (target: string) => Promise<StopSessionResult>;
}
