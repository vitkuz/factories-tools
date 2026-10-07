import type { FileSystemAdapter } from '../../../adapters/file-system/index.js';
import { DEFAULT_HARNESS, agentProfileCandidatesFor, type Harness } from '../../harness/index.js';
import { isCustomAgent } from '../../pipeline/index.js';
import type { PathAnchors } from '../../pipeline/index.js';

export interface AgentProfile {
  /** Undefined means: run as general-purpose. */
  profile?: string;
  note?: string;
}

/**
 * A named custom agent that cannot be found never stops the run: general-purpose stands in, and
 * the run says so once, because the step then ran without that agent's tool limits or persona.
 */
export const resolveAgentProfileFactory =
  (fileSystem: FileSystemAdapter, anchors: PathAnchors, harness: Harness = DEFAULT_HARNESS) =>
  async (agent: string): Promise<AgentProfile> => {
    if (!isCustomAgent(agent)) return {};
    const found: boolean[] = await Promise.all(
      agentProfileCandidatesFor(harness)(anchors, agent).map(fileSystem.exists),
    );
    return found.some(Boolean)
      ? { profile: agent }
      : { note: `agent "${agent}" has no profile; general-purpose stood in` };
  };
