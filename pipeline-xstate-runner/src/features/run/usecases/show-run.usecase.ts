import type { Result } from '../../../shared/types/result.types.js';
import { map } from '../../../shared/utils/result.utils.js';
import { readStateFactory } from '../../state/services/read-state.service.js';
import type { State } from '../../state/state.types.js';
import { normalizeState } from '../../state/state.utils.js';
import type { RunDeps } from '../run.types.js';

/** show = state.json, in its written form. Needs no pipeline and no snapshot. */
export const showRunFactory =
  (deps: Pick<RunDeps, 'fileSystem'>) =>
  (runDir: string): Result<State> =>
    map(normalizeState)(readStateFactory(deps.fileSystem)(runDir));
