import type { PassRecord, RunState, StepState } from './types';

/**
 * Per-pass timing of a step, so a loop that ran four times reports the time of all four,
 * not only the last one. Sources, in order of trust:
 *   1. `steps.<slug>.history` — every finished pass, written by the state tool.
 *   2. the step's own `startedAt` / `completedAt` — one pass.
 *
 * A pass is either `work` (an agent ran) or `wait` (a person was asked to answer). Waiting
 * for a human is not working time: a wait is listed, so the inspector can say
 * "waiting since …", but never summed. Everything here is pure and curried.
 */

export type AttemptKind = 'work' | 'wait';

export interface Attempt {
  attempt: number;
  kind: AttemptKind;
  startedAt: string | null;
  finishedAt: string | null;
  result: string | null;
  /** Still in flight (running, or paused on a person): `finishedAt` is null. */
  open: boolean;
}

const HUMAN_AGENT = 'human';

const isOpen = (st: StepState): boolean => st.status === 'RUNNING' || st.status === 'RETRYING';

/** A step run by a person rather than an agent. */
const isHuman = (st: StepState): boolean => st.agent === HUMAN_AGENT;

const openAttempt = (attempt: number, startedAt: string | null, kind: AttemptKind): Attempt => ({
  attempt,
  kind,
  startedAt,
  finishedAt: null,
  result: null,
  open: true,
});

const fromHistory = (st: StepState, kind: AttemptKind): Attempt[] =>
  (st.history ?? []).map((pass: PassRecord): Attempt => ({
    attempt: pass.pass,
    kind,
    startedAt: pass.startAt ?? null,
    finishedAt: pass.endAt ?? null,
    result: pass.event ?? null,
    open: false,
  }));

/** The single pass a step's own timestamps describe (none when it never started). */
const fromStep = (st: StepState, kind: AttemptKind): Attempt[] => {
  if (!st.startedAt && !st.completedAt) return [];
  const open: boolean = isOpen(st);
  return [
    {
      attempt: Math.max(1, st.passes ?? st.retryCount + 1),
      kind,
      startedAt: st.startedAt ?? null,
      finishedAt: open ? null : (st.completedAt ?? null),
      result: open ? null : (st.event ?? null),
      open,
    },
  ];
};

/**
 * Every pass of a step, oldest first. `human` says whether the step is a human gate (its
 * passes are waits); when the caller does not know, the step state decides.
 */
export const attemptsOf =
  (state: RunState | null) =>
  (slug: string, human?: boolean): Attempt[] => {
    const st: StepState | undefined = state?.steps?.[slug];
    if (!st) return [];
    const open: boolean = isOpen(st);
    const kind: AttemptKind = (human ?? isHuman(st)) ? 'wait' : 'work';

    const history: Attempt[] = fromHistory(st, kind);
    if (history.length > 0) {
      return open
        ? [...history, openAttempt(history.length + 1, st.startedAt ?? null, kind)]
        : history;
    }
    return fromStep(st, kind);
  };

/** How long an attempt has run (or waited): null without a start time. */
export const attemptSpanMs = (a: Attempt, now: number): number | null => {
  if (!a.startedAt) return null;
  const start: number = Date.parse(a.startedAt);
  const end: number = a.finishedAt ? Date.parse(a.finishedAt) : now;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
};

/** Sum of every work attempt's span (waits excluded); `null` when no work attempt has a start time. */
export const workingTimeMs = (attempts: readonly Attempt[], now: number): number | null =>
  attempts.reduce((total: number | null, a: Attempt): number | null => {
    if (a.kind === 'wait') return total;
    const ms: number | null = attemptSpanMs(a, now);
    return ms === null ? total : (total ?? 0) + ms;
  }, null);

/** Working time of the whole run: every work attempt of every step. */
export const runWorkingTimeMs =
  (state: RunState | null) =>
  (now: number): number | null => {
    if (!state) return null;
    return Object.keys(state.steps).reduce((total: number | null, slug: string): number | null => {
      const ms: number | null = workingTimeMs(attemptsOf(state)(slug), now);
      return ms === null ? total : (total ?? 0) + ms;
    }, null);
  };

/** The [start, end] span of every work attempt with a start time (an open one ends at `now`). */
const workSpans = (attempts: readonly Attempt[], now: number): Array<[number, number]> =>
  attempts.flatMap((a: Attempt): Array<[number, number]> => {
    if (a.kind === 'wait' || !a.startedAt) return [];
    const ms: number | null = attemptSpanMs(a, now);
    if (ms === null) return [];
    const start: number = Date.parse(a.startedAt);
    return [[start, start + ms]];
  });

const spansOverlap = (a: readonly [number, number][], b: readonly [number, number][]): boolean =>
  a.some(([s1, e1]: [number, number]) =>
    b.some(([s2, e2]: [number, number]) => s1 < e2 && s2 < e1),
  );

/**
 * How many steps had an agent running while another step's agent was running — the reason
 * a run's working time (a sum of agent time) can exceed its wall-clock duration. Either 0
 * (every step ran on its own) or at least 2.
 */
export const parallelStepCount =
  (state: RunState | null) =>
  (now: number): number => {
    if (!state) return 0;
    const spans: Array<[number, number]>[] = Object.keys(state.steps).map(
      (slug: string): Array<[number, number]> => workSpans(attemptsOf(state)(slug), now),
    );
    return spans.filter((own: Array<[number, number]>, i: number): boolean =>
      spans.some(
        (other: Array<[number, number]>, j: number): boolean => i !== j && spansOverlap(own, other),
      ),
    ).length;
  };

/** The last finished wait of a human gate — how long the person took; null while nobody has answered. */
export const lastWaitedMs = (attempts: readonly Attempt[], now: number): number | null => {
  const last: Attempt | undefined = [...attempts]
    .reverse()
    .find((a: Attempt) => a.kind === 'wait' && !a.open);
  return last ? attemptSpanMs(last, now) : null;
};

/** True while some agent is running: the run's working time is still growing. */
export const isWorking = (attempts: readonly Attempt[]): boolean =>
  attempts.some((a) => a.open && a.kind === 'work');

/** Attempts with a finish (what a completed card sums). */
export const closedAttempts = (attempts: readonly Attempt[]): Attempt[] =>
  attempts.filter((a) => !a.open);
