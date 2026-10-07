import type { RunStatus } from './types';

export interface RunStatusMeta {
  label: string;
  /** CSS custom property carrying the status colour. */
  token: string;
}

export const RUN_STATUS_META: Record<RunStatus, RunStatusMeta> = {
  IDLE: { label: 'Pending', token: '--st-pending' },
  RUNNING: { label: 'Running', token: '--st-running' },
  PAUSED: { label: 'Waiting for you', token: '--st-waiting' },
  COMPLETED: { label: 'Completed', token: '--st-completed' },
  ABORTED: { label: 'Aborted', token: '--st-failed' },
  FAILED: { label: 'Failed', token: '--st-failed' },
};

export const runStatusLabel = (s: RunStatus): string => RUN_STATUS_META[s]?.label ?? s;

/** Short lowercase word for the run picker: "completed", "running", "no state"… */
export const runStatusWord = (s: RunStatus | null | undefined): string =>
  s ? (RUN_STATUS_META[s]?.label.toLowerCase() ?? s) : 'no state';

/** The run is stopped on a person: the state is PAUSED and the pause is still open. */
export const isAwaitingHuman = (status: RunStatus | null | undefined): boolean =>
  status === 'PAUSED';
