import { createRunEffects } from '../services/create-run-effects.service.js';
import { driveRunFactory } from '../services/drive-run.service.js';
import { openRunDirFactory } from '../services/open-run-dir.service.js';
import type { StoredRun } from '../services/open-run-dir.service.js';
import { outcomeOf } from '../services/outcome-of.service.js';
import type { RunDeps, RunOutcome } from '../run.types.js';
import { harnessOf } from './run-pipeline.usecase.js';

export interface ResumeRequest {
  runDir: string;
  /** Another harness than the one recorded in state.json, when given. */
  harness?: string;
}

/**
 * resume = read the snapshot (its machine version must match) → restore the run machine without
 * its children → RESUME: whatever was running or interrupted runs again as a new pass. The clock
 * starts after the last timestamp the run wrote, so time never goes backwards in state.json.
 */
export const resumeRunFactory =
  (deps: RunDeps) =>
  async (request: ResumeRequest): Promise<RunOutcome> => {
    const stored = openRunDirFactory(deps)(request.runDir);
    if (!stored.ok) return { kind: 'refused', ...stored.refusal };
    const run: StoredRun = stored.value;
    const harnessName: string =
      request.harness ??
      String(run.state.context.captured['harness'] ?? run.context.input.options.harness);
    const harness = harnessOf(deps)(harnessName);
    if (!harness.ok) return { kind: 'refused', ...harness.refusal };

    const resumed: RunDeps = { ...deps, clock: deps.clockAfter(run.state.updatedAt) };
    const snapshot = await driveRunFactory(resumed)({
      effects: createRunEffects(resumed)(harness.value),
      start: { snapshot: run.snapshot.snapshot },
      kick: { type: 'RESUME', at: resumed.clock.now() },
    });
    return outcomeOf(snapshot);
  };
