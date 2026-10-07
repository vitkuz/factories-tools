import type { AgentPort } from '../../features/run/index.js';
import type { HarnessAdapterSettings } from '../agent-shared/index.js';

export type CopilotAdapterSettings = HarnessAdapterSettings;

/** The runner's AgentPort, carried out by one headless `copilot` process per call. */
export type CopilotAdapter = AgentPort;
