/**
 * Runs recorded before the current state tool existed.
 *
 * `investigate-app-factory`, `browser-launch-factory` and `fetch-jira-ticket-factory` have
 * no recorder today (`/add-state-management-to-factory` has not been run on them), and the
 * `state.json` files sitting in their run folders were written by an earlier one. That
 * recorder used different names for the same facts — `pipeline` for `pipelineName`,
 * `startAt` for `createdAt`, lowercase statuses, a `log` of objects — so those runs are read
 * through here and then validated like any other.
 *
 * Nothing writes this format any more. When those factories get the current recorder they
 * will write the current schema and stop coming through this file; it stays only so their
 * history keeps rendering.
 *
 * The `pipeline.json` snapshot a run keeps has an older dialect too: until the prompt format
 * changed, a step's `prompt` was one string and its system prompt was `systemPrompt`, also a
 * string. Every run recorded before that change carries such a snapshot, so it is upgraded
 * here (`upgradeLegacyStep`) before the pipeline schema sees it. The lines are the string
 * split on newlines, which is exactly what the runner joins them back from.
 */

/** A step written before prompts became line arrays: a string `prompt`, or a `systemPrompt`. */
export const isLegacyStep = (value: unknown): boolean => {
  const step = value as Record<string, unknown> | null;
  return (
    typeof step === 'object' &&
    step !== null &&
    (typeof step.prompt === 'string' || typeof step.systemPrompt === 'string')
  );
};

const toLines = (value: unknown): unknown =>
  typeof value === 'string' ? value.split('\n') : value;

/** One older step in the current shape: `prompt` as lines, `systemPrompt` as `system` lines. */
export const upgradeLegacyStep = (value: unknown): unknown => {
  if (!isLegacyStep(value)) return value;
  const { systemPrompt, ...step } = value as Record<string, unknown>;
  const system: unknown = toLines(step.system ?? systemPrompt);
  return {
    ...step,
    prompt: toLines(step.prompt),
    ...(system === undefined ? {} : { system }),
  };
};

const RUN_STATUS: Record<string, string> = {
  done: 'COMPLETED',
  completed: 'COMPLETED',
  running: 'RUNNING',
  pending: 'IDLE',
  paused: 'PAUSED',
  aborted: 'ABORTED',
  failed: 'FAILED',
  error: 'FAILED',
};

const STEP_STATUS: Record<string, string> = {
  done: 'COMPLETED',
  completed: 'COMPLETED',
  running: 'RUNNING',
  pending: 'PENDING',
  skipped: 'SKIPPED',
  failed: 'FAILED',
  error: 'FAILED',
};

/** A state file from the older recorder: it names the pipeline in `pipeline`, not `pipelineName`. */
export const isLegacyState = (value: unknown): boolean => {
  const s = value as Record<string, unknown> | null;
  return (
    typeof s === 'object' &&
    s !== null &&
    typeof s.pipeline === 'string' &&
    typeof s.pipelineName !== 'string'
  );
};

const upgradeStep = (step: Record<string, unknown>): Record<string, unknown> => ({
  ...step,
  order: typeof step.index === 'number' ? step.index : 0,
  status: STEP_STATUS[String(step.status ?? '').toLowerCase()] ?? 'PENDING',
  startedAt: step.startAt ?? null,
  completedAt: step.endAt ?? null,
  outputs: Array.isArray(step.outputs) ? step.outputs : [],
  retryCount: Math.max(0, (typeof step.passes === 'number' ? step.passes : 1) - 1),
  history: Array.isArray(step.history) ? step.history : [],
});

/** Log entries were objects; the history the dashboard shows is `{ timestamp, type, message }`. */
const upgradeLog = (entry: unknown): Record<string, unknown> => {
  if (typeof entry === 'string') return { message: entry };
  const e = entry as Record<string, unknown>;
  const targets = Array.isArray(e.targets) ? e.targets : [];
  return {
    timestamp: typeof e.at === 'string' ? e.at : null,
    type: typeof e.action === 'string' ? e.action : undefined,
    message: [e.step, e.event, targets.length > 0 ? `→ ${targets.join(', ')}` : null]
      .filter(Boolean)
      .join(' '),
    details: e,
  };
};

/**
 * One older state file in the current shape. `runId` is not in the file — the run folder is
 * the id — so the caller's fallback is used.
 */
export const upgradeLegacyState = (value: unknown, runId: string): unknown => {
  if (!isLegacyState(value)) return value;
  const s = value as Record<string, unknown>;
  const steps = (s.steps ?? {}) as Record<string, Record<string, unknown>>;
  return {
    ...s,
    runId,
    pipelineName: s.pipeline,
    status: RUN_STATUS[String(s.status ?? '').toLowerCase()] ?? 'IDLE',
    createdAt: s.startAt,
    updatedAt: s.updatedAt ?? s.startAt,
    mode: 'graph',
    frontier: Array.isArray(s.frontier) ? s.frontier : [],
    activeSteps: [],
    context: {
      constants: (s.constants ?? {}) as Record<string, unknown>,
      params: (s.params ?? {}) as Record<string, unknown>,
      captured: (s.vars ?? {}) as Record<string, unknown>,
    },
    steps: Object.fromEntries(
      Object.entries(steps).map(([slug, step]) => [slug, upgradeStep(step)]),
    ),
    history: (Array.isArray(s.log) ? s.log : []).map(upgradeLog),
    edges: (s.edges ?? {}) as Record<string, number>,
  };
};
