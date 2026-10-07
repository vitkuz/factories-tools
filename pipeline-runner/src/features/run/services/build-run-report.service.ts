import { END } from '../../pipeline/index.js';
import type { ResolvedPipeline } from '../../pipeline/index.js';
import type { HistoryEvent, HookReport, RunReport, RunState, StepRecord } from '../run.types.js';
import { stateFileOf } from './state-store.service.js';

const targetsOf = (event: HistoryEvent): string[] =>
  Array.isArray(event.details?.['targets']) ? (event.details['targets'] as string[]) : [];

/** The run read back from its own record — never from what the runner remembers doing. */
export const buildRunReport = (
  pipeline: ResolvedPipeline,
  state: RunState,
  hooks: HookReport[],
): RunReport => {
  const enders: HistoryEvent[] = state.history.filter(
    (event: HistoryEvent): boolean =>
      ['STEP_EVENT', 'HUMAN_ANSWER'].includes(event.type) && targetsOf(event).includes(END),
  );
  const failure: HistoryEvent | undefined = state.history.find(
    (event: HistoryEvent): boolean => event.type === 'PIPELINE_FAIL',
  );
  const records: [string, StepRecord][] = Object.entries(state.steps);
  return {
    status: state.status,
    runId: state.runId,
    outputDir: pipeline.outputDir,
    stateFile: stateFileOf(pipeline.outputDir),
    params: pipeline.params,
    endedBy: enders.map(
      (event: HistoryEvent): string =>
        `${event.step ?? ''}:${String(event.details?.['event'] ?? '')}`,
    ),
    deliverables: [
      ...new Set(
        enders.flatMap(
          (event: HistoryEvent): string[] => state.steps[event.step ?? '']?.outputs ?? [],
        ),
      ),
    ],
    ...(failure === undefined
      ? {}
      : { failure: String(failure.details?.['reason'] ?? failure.message) }),
    capped: state.history
      .filter((event: HistoryEvent): boolean => event.type === 'EDGE_CAPPED')
      .map((event: HistoryEvent): string => event.message),
    skipped: records
      .filter(([, record]: [string, StepRecord]): boolean => record.status === 'SKIPPED')
      .map(([step, record]: [string, StepRecord]): { step: string; reason: string } => ({
        step,
        reason: record.skipReason ?? '',
      })),
    failed: records
      .filter(([, record]: [string, StepRecord]): boolean => record.status === 'FAILED')
      .map(([step, record]: [string, StepRecord]): { step: string; error: string } => ({
        step,
        error: record.error ?? '',
      })),
    passes: Object.fromEntries(
      records.map(([step, record]: [string, StepRecord]): [string, number] => [
        step,
        record.passes ?? 0,
      ]),
    ),
    hooks,
    ...(state.context.captured.harness === undefined
      ? {}
      : { harness: state.context.captured.harness }),
    costUsd: state.context.captured.costUsd,
    usage: state.context.captured.usage,
  };
};
