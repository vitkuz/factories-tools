import path from 'node:path';
import type { FileSystemAdapter } from '../../../adapters/file-system/index.js';
import type { LoggerPort } from '../../../shared/types/logger.types.js';
import { errorMessage } from '../../../shared/utils/error.utils.js';
import type { Harness } from '../../harness/index.js';
import type { ResolvedPipeline, ResolvedStep } from '../../pipeline/index.js';
import { addUsage } from '../run-state.utils.js';
import type {
  AgentPort,
  AgentRequest,
  AgentResult,
  AgentUsage,
  PassInfo,
  StepMaterials,
  StepOutcome,
} from '../run.types.js';
import { buildRetryPrompt, buildStepPrompt } from './build-step-prompt.service.js';
import {
  collectStepMaterialsFactory,
  expandFilesFactory,
} from './collect-step-materials.service.js';
import { resolveAgentProfileFactory, type AgentProfile } from './resolve-agent-profile.service.js';

export interface ExecuteStepDeps {
  agent: AgentPort;
  fileSystem: FileSystemAdapter;
  logger: LoggerPort;
  /** Whose custom agents to look for. Claude when left out. */
  harness?: Harness;
}

export type ExecuteStep = (
  step: ResolvedStep,
  pass: PassInfo,
  signal?: AbortSignal,
) => Promise<StepOutcome>;

/** The files a step really produced, relative to the run folder — the pattern is never recorded. */
export const collectOutputsFactory =
  (fileSystem: FileSystemAdapter, outputDir: string) =>
  async (step: ResolvedStep): Promise<string[]> => {
    const files: string[] = (
      await Promise.all(step.output.map(expandFilesFactory(fileSystem)))
    ).flat();
    return files.map((file: string): string => path.relative(outputDir, file));
  };

/**
 * One subagent for one pass of one step. If its answer names no event of the step, it is asked
 * once more in the same session; a second miss is an error. Never throws: a failure is an outcome.
 */
export const executeAgentStepFactory =
  (deps: ExecuteStepDeps) =>
  (pipeline: ResolvedPipeline): ExecuteStep => {
    const collectMaterials = collectStepMaterialsFactory(deps.fileSystem);
    const collectOutputs = collectOutputsFactory(deps.fileSystem, pipeline.outputDir);
    const resolveProfile = resolveAgentProfileFactory(
      deps.fileSystem,
      pipeline.anchors,
      deps.harness,
    );

    return async (
      step: ResolvedStep,
      pass: PassInfo,
      signal?: AbortSignal,
    ): Promise<StepOutcome> => {
      const events: string[] = Object.keys(step.transitions);
      const knows = (result: AgentResult): boolean =>
        result.event !== undefined && events.includes(result.event);
      try {
        const [materials, profile]: [StepMaterials, AgentProfile] = await Promise.all([
          collectMaterials(step),
          resolveProfile(step.agent),
        ]);
        await deps.fileSystem.makeDir(step.workDir);
        // A degraded step, never a halted run: what it ran without goes in the log and the record.
        const notes: string[] = [
          ...(profile.note === undefined ? [] : [profile.note]),
          ...(materials.missingKnowledge.length === 0
            ? []
            : [`ran without knowledge: ${materials.missingKnowledge.join(', ')}`]),
        ];
        notes.forEach((note: string): void => deps.logger.warn(note, { step: step.name }));

        const request: AgentRequest = {
          stepName: step.name,
          prompt: buildStepPrompt(step, materials, pass),
          ...(step.systemPrompt === undefined ? {} : { systemPrompt: step.systemPrompt }),
          ...(step.model === undefined ? {} : { model: step.model }),
          ...(profile.profile === undefined ? {} : { agentProfile: profile.profile }),
          // The repository root, not workDir: project settings, agents and MCP servers hang off it.
          cwd: pipeline.anchors.rootPath,
          runDir: pipeline.outputDir,
          allowedEvents: events,
          ...(signal === undefined ? {} : { signal }),
        };

        const first: AgentResult = await deps.agent.runAgent(request);
        const answer: AgentResult =
          knows(first) || first.sessionId === undefined
            ? first
            : await deps.agent.runAgent({
                ...request,
                prompt: buildRetryPrompt(first.event, events),
                resumeSessionId: first.sessionId,
              });
        if (!knows(answer) || answer.event === undefined) {
          return {
            kind: 'error',
            step: step.name,
            error: `returned "${answer.event ?? ''}", which is not one of ${events.join(', ')}`,
          };
        }

        const sessionId: string | undefined = first.sessionId ?? answer.sessionId;
        const transcriptPath: string | undefined = first.transcriptPath ?? answer.transcriptPath;
        const calls: AgentResult[] = answer === first ? [first] : [first, answer];
        const priced: AgentResult[] = calls.filter(
          (call: AgentResult): boolean => call.costUsd !== undefined,
        );
        const costUsd = priced.reduce(
          (sum: number, call: AgentResult): number => sum + (call.costUsd ?? 0),
          0,
        );
        // A retry whose figure already covers the session stands alone; otherwise the calls add up.
        const metered: AgentResult[] = (
          answer !== first && answer.usageCoversSession === true ? [answer] : calls
        ).filter((call: AgentResult): boolean => call.usage !== undefined);
        return {
          kind: 'event',
          step: step.name,
          event: answer.event,
          reported: { ...first.reported, ...answer.reported },
          note: notes.join('; '),
          outputs: await collectOutputs(step),
          human: false,
          ...(sessionId === undefined ? {} : { sessionId }),
          ...(transcriptPath === undefined ? {} : { transcriptPath }),
          // Dollars only when the harness named dollars: an absent cost is not a free step.
          ...(priced.length === 0 ? {} : { costUsd }),
          ...(metered.length === 0
            ? {}
            : {
                usage: metered.reduce(
                  (sum: AgentUsage, call: AgentResult): AgentUsage => addUsage(sum, call.usage),
                  {},
                ),
              }),
          ...(first.durationMs === undefined ? {} : { durationMs: first.durationMs }),
        };
      } catch (error) {
        return { kind: 'error', step: step.name, error: errorMessage(error) };
      }
    };
  };
