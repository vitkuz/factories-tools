// Learned from factories-tools/pipeline-runner/src/features/run/services/build-run-report.service.ts
import type { AgentUsage } from '../../../clients/harness/harness.types.js';
import type { HookReport, RunContext } from '../../machines/machines.types.js';
import { END } from '../../pipeline/pipeline.utils.js';
import type { HistoryEntry, State, StepRecord } from '../../state/state.types.js';
import { statePathFor } from '../../state/state.utils.js';
import type { RunReport } from '../run.types.js';

const targetsOf = (entry: HistoryEntry): string[] =>
  Array.isArray(entry.details?.['targets']) ? (entry.details['targets'] as string[]) : [];

const captured = <T>(state: State, key: string, fallback: T): T =>
  (state.context.captured[key] as T | undefined) ?? fallback;

/** The run as its state.json tells it; the machine context adds only what the file does not hold. */
export const buildRunReport = (context: RunContext, state: State): RunReport => {
  const history: HistoryEntry[] = state.history ?? [];
  const enders: HistoryEntry[] = history.filter(
    (entry: HistoryEntry): boolean =>
      ['STEP_EVENT', 'HUMAN_ANSWER'].includes(entry.type) && targetsOf(entry).includes(END),
  );
  const failure: HistoryEntry | undefined = history.find(
    (entry: HistoryEntry): boolean => entry.type === 'PIPELINE_FAIL',
  );
  const records: [string, StepRecord][] = Object.entries(state.steps);
  const runDir: string = context.pipeline?.outputDir ?? '';
  const parked = state.pause?.status === 'AWAITING_INPUT' ? state.pause : undefined;
  const harness: string | undefined = captured<string | undefined>(state, 'harness', undefined);
  return {
    status: state.status,
    runId: state.runId,
    runDir,
    stateFile: statePathFor(runDir),
    params: state.context.params as RunReport['params'],
    endedBy: enders.map(
      (entry: HistoryEntry): string =>
        `${entry.step ?? ''}:${String(entry.details?.['event'] ?? '')}`,
    ),
    deliverables: [
      ...new Set(
        enders.flatMap(
          (entry: HistoryEntry): string[] => state.steps[entry.step ?? '']?.outputs ?? [],
        ),
      ),
    ],
    ...(failure === undefined
      ? {}
      : { failure: String(failure.details?.['reason'] ?? failure.message) }),
    capped: history
      .filter((entry: HistoryEntry): boolean => entry.type === 'EDGE_CAPPED')
      .map((entry: HistoryEntry): string => entry.message),
    skipped: records
      .filter(([, record]: [string, StepRecord]): boolean => record.status === 'SKIPPED')
      .map(([step, record]: [string, StepRecord]) => ({ step, reason: record.skipReason ?? '' })),
    failed: records
      .filter(([, record]: [string, StepRecord]): boolean => record.status === 'FAILED')
      .map(([step, record]: [string, StepRecord]) => ({ step, error: record.error ?? '' })),
    passes: Object.fromEntries(
      records.map(([step, record]: [string, StepRecord]): [string, number] => [
        step,
        record.passes ?? 0,
      ]),
    ),
    hooks: context.hooks as HookReport[],
    ...(harness === undefined ? {} : { harness }),
    costUsd: captured<number>(state, 'costUsd', 0),
    usage: captured<AgentUsage>(state, 'usage', {}),
    ...(parked === undefined
      ? {}
      : {
          awaiting: {
            step: parked.step,
            ask: parked.ask,
            events: Object.keys(context.pipeline?.steps[parked.step]?.transitions ?? {}),
            present: parked.present ?? [],
          },
        }),
  };
};
