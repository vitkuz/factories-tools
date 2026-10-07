/** 0: COMPLETED. 1: the run failed or something broke. 2: refused, or a bad call; nothing written. 3: parked for a person. */
export const EXIT = { ok: 0, failed: 1, refused: 2, parked: 3 } as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export interface Output {
  out: (text: string) => void;
  err: (text: string) => void;
}

/** The options every command may carry, as commander hands them back. */
export interface EngineOptions {
  root?: string;
  harness?: string;
  defaultModel?: string;
  permissionMode?: string;
  stepTimeout?: string;
  maxStepPasses?: string;
  human?: string;
  inspect?: string;
  script?: string;
  json?: boolean;
}

export interface RunCommandOptions extends EngineOptions {
  param: Record<string, string>;
}

export interface AnswerCommandOptions extends EngineOptions {
  note?: string;
  output?: string[];
}

export interface ResolveCommandOptions extends EngineOptions {
  param: Record<string, string>;
  prompt?: string;
}

/** Commander's collector for a repeatable `-p name=value`. */
export const collectParam = (
  entry: string,
  collected: Record<string, string>,
): Record<string, string> => {
  const at: number = entry.indexOf('=');
  if (at < 1) throw new Error(`-p takes name=value, got "${entry}"`);
  return { ...collected, [entry.slice(0, at).trim()]: entry.slice(at + 1) };
};

export const collect = (value: string, previous: string[]): string[] => [...previous, value];
