import type { AgentPort } from '../../features/run/index.js';
import type { HarnessAdapterSettings, ScratchSettings } from '../agent-shared/index.js';

/** `agy` takes the prompt on argv only, so a prompt too large for argv is handed over as a file. */
export interface AgyAdapterSettings extends HarnessAdapterSettings, ScratchSettings {
  /** Prompts above this many bytes go to a file. Linux allows ~128 kB per argument. */
  maxArgvPromptBytes?: number;
}

/** The runner's AgentPort, carried out by one headless `agy --print` process per call. */
export type AgyAdapter = AgentPort;
