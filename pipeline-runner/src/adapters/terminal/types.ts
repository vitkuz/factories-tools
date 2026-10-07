import type { HumanPort } from '../../features/run/index.js';

export interface TerminalAdapterSettings {
  input: NodeJS.ReadableStream & { isTTY?: boolean };
  /** Questions are written here — stderr, so stdout stays the command's result. */
  output: NodeJS.WritableStream;
}

export type TerminalAdapter = HumanPort;
