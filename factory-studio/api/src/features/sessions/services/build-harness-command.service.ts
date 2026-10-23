import type { Harness } from '../sessions.types.js';
import { shellQuote } from '../sessions.utils.js';

interface HarnessLaunch {
  /** The binary and the flags that turn every approval prompt off — as in `~/.ai-aliases.sh`. */
  base: string;
  /** How this harness takes an initial prompt and stays interactive afterwards. */
  promptFlag: string;
}

/**
 * Claude runs with every approval prompt off. Plan mode stays off (nothing answers its
 * approval); AskUserQuestion stays on: the studio's hook (`--settings`) shows it in the app
 * and answers it. `--disallowedTools=` keeps the list to one argument (the flag is variadic and
 * would otherwise swallow the prompt).
 */
const CLAUDE_QUESTIONS_PROMPT: string =
  "--disallowedTools=EnterPlanMode,ExitPlanMode --append-system-prompt 'You run inside Factory Studio and may run unattended. Prefer the most reasonable decision: note the assumption and carry on to the end. Use AskUserQuestion only when a decision truly cannot be made without the person; the question is shown in the studio app, so ask clearly, once, and wait for the answer.'";

const LAUNCH: Readonly<Record<Harness, HarnessLaunch>> = {
  copilot: { base: 'copilot --allow-all', promptFlag: '-i ' },
  claude: { base: 'claude --dangerously-skip-permissions', promptFlag: '' },
  agy: { base: 'agy --dangerously-skip-permissions', promptFlag: '-i ' },
  codex: { base: 'codex --dangerously-bypass-approvals-and-sandbox', promptFlag: '' },
};

/**
 * The shell command a session runs. The prompt itself never enters this string: the harness
 * receives it as one argument via `"$(cat file)"`, so quotes, backticks or a `$(` inside the
 * prompt stay text. The only interpolated value is the file path, which the API chose.
 */
export interface HarnessCommandOptions {
  /** Claude only: the per-session settings file that wires the question hook. */
  settingsFile?: string;
}

/** Flags that go between the base command and the prompt, per harness. */
const extraFlags = (harness: Harness, { settingsFile }: HarnessCommandOptions): string =>
  harness === 'claude'
    ? [settingsFile ? `--settings ${shellQuote(settingsFile)}` : '', CLAUDE_QUESTIONS_PROMPT]
        .filter((flag: string): boolean => flag !== '')
        .join(' ')
    : '';

/**
 * The shell command a session runs. The prompt itself never enters this string: the harness
 * receives it as one argument via `"$(cat file)"`, so quotes, backticks or a `$(` inside the
 * prompt stay text. The only interpolated values are file paths, which the API chose.
 */
export const buildHarnessCommand = (
  harness: Harness,
  promptFile: string,
  options: HarnessCommandOptions = {},
): string => {
  const { base, promptFlag }: HarnessLaunch = LAUNCH[harness];
  const flags: string = extraFlags(harness, options);
  return `${[base, flags].filter((part: string): boolean => part !== '').join(' ')} ${promptFlag}"$(cat ${shellQuote(promptFile)})"`;
};

export const harnessCommandBase = (harness: Harness): string => LAUNCH[harness].base;
