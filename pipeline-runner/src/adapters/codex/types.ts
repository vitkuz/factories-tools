import type { AgentPort } from '../../features/run/index.js';
import type { HarnessAdapterSettings, ScratchSettings } from '../agent-shared/index.js';

/** Codex takes the answer schema as a file, so this adapter is the first that writes one. */
export interface CodexAdapterSettings extends HarnessAdapterSettings, ScratchSettings {}

/** The runner's AgentPort, carried out by one `codex exec` process per call. */
export type CodexAdapter = AgentPort;
