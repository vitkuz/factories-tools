import type { LoggerPort } from '../src/shared/types/logger.types.js';
import { resolvePipeline } from '../src/features/pipeline/services/index.js';
import type { ResolvedPipeline } from '../src/features/pipeline/index.js';
import type {
  AgentPort,
  AgentRequest,
  AgentResult,
  HumanPort,
  RunPipelineDeps,
  ShellPort,
  ShellResult,
} from '../src/features/run/index.js';
import { context, load, memoryFileSystem, ROOT } from './helpers.js';

export const silentLogger: LoggerPort = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export type Reply =
  string | (Partial<AgentResult> & { event?: string; throws?: string; afterMs?: number });

export interface ScriptedAgent extends AgentPort {
  calls: AgentRequest[];
  /** Step names in the order their agents STARTED and FINISHED — what fan-in is judged by. */
  timeline: string[];
}

/** An agent that answers from a script: per step, one reply per call, in order. */
export const scriptedAgent = (script: Record<string, Reply[]>): ScriptedAgent => {
  const calls: AgentRequest[] = [];
  const timeline: string[] = [];
  const cursor: Map<string, number> = new Map();
  return {
    calls,
    timeline,
    runAgent: async (request: AgentRequest): Promise<AgentResult> => {
      calls.push(request);
      timeline.push(`start:${request.stepName}`);
      const index = cursor.get(request.stepName) ?? 0;
      cursor.set(request.stepName, index + 1);
      const raw: Reply | undefined = script[request.stepName]?.[index];
      if (raw === undefined)
        throw new Error(`script has no reply #${index + 1} for ${request.stepName}`);
      const reply = typeof raw === 'string' ? { event: raw } : raw;
      await new Promise((resolve) => setTimeout(resolve, reply.afterMs ?? 1));
      timeline.push(`end:${request.stepName}`);
      if (reply.throws !== undefined) throw new Error(reply.throws);
      return {
        reported: {},
        text: '',
        sessionId: `session-${request.stepName}-${index + 1}`,
        costUsd: 0.01,
        ...reply,
      };
    },
  };
};

export const scriptedShell = (
  exitCodes: Record<string, number> = {},
): ShellPort & { commands: string[] } => {
  const commands: string[] = [];
  return {
    commands,
    run: async (command: string): Promise<ShellResult> => {
      commands.push(command);
      const failing: string | undefined = Object.keys(exitCodes).find((needle: string): boolean =>
        command.includes(needle),
      );
      return {
        command,
        exitCode: failing === undefined ? 0 : (exitCodes[failing] ?? 0),
        output: '',
      };
    },
  };
};

export const scriptedHuman = (answers: { event: string; note: string }[]): HumanPort => {
  const queue = [...answers];
  return { ask: async () => queue.shift() ?? { event: 'NONE', note: '' } };
};

export interface Bench {
  pipeline: ResolvedPipeline;
  agent: ScriptedAgent;
  shell: ReturnType<typeof scriptedShell>;
  fileSystem: ReturnType<typeof memoryFileSystem>;
  deps: RunPipelineDeps;
}

export const bench = (
  script: Record<string, Reply[]>,
  definition?: Record<string, unknown>,
  extras: { shell?: ReturnType<typeof scriptedShell>; human?: HumanPort } = {},
): Bench => {
  const pipeline: ResolvedPipeline = resolvePipeline(context())(load(definition));
  const agent: ScriptedAgent = scriptedAgent(script);
  const shell = extras.shell ?? scriptedShell();
  const fileSystem = memoryFileSystem({
    [`${ROOT}/knowledge/outline.md`]: 'Shape the outline like this.',
  });
  let tick = 0;
  let id = 0;
  const deps: RunPipelineDeps = {
    agent,
    human: extras.human ?? scriptedHuman([]),
    shell,
    fileSystem,
    logger: silentLogger,
    now: (): Date => new Date(Date.UTC(2026, 8, 17, 10, 0, tick++)),
    newId: (): string => `0000000${id++}-aaaa`,
  };
  return { pipeline, agent, shell, fileSystem, deps };
};
