import type { z } from 'zod';
import type { PathAnchors } from '../pipeline/index.js';
import type { harnessSchema, permissionModeSchema, tierMapSchema } from './harness.schema.js';

export type Harness = z.infer<typeof harnessSchema>;
export type PermissionMode = z.infer<typeof permissionModeSchema>;
/** tier (`fable|opus|sonnet|haiku`) → the model id this harness should be started with. */
export type TierMap = z.infer<typeof tierMapSchema>;

/** Where one harness keeps custom agent profiles. Undefined for a harness with no such concept. */
export interface AgentHome {
  /** How the place is named in a warning. */
  label: string;
  candidates: (anchors: PathAnchors, agent: string) => string[];
}
