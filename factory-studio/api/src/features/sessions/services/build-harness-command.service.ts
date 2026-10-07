import type { Harness } from '../sessions.types.js';
import { shellQuote } from '../sessions.utils.js';

interface HarnessLaunch {
  /** The binary and the flags that turn every approval prompt off — as in `~/.ai-aliases.sh`. */
  base: string;
  /** How this harness takes an initial prompt and stays interactive afterwards. */
  promptFlag: string;
}

/**
 * Claude runs unattended in tmux: no permission prompts, and no tool that stops to ask the user
 * a question or to approve a plan. `--disallowedTools=` keeps the list to one argument (the flag
 * is variadic and would otherwise swallow the prompt).
 */
const CLAUDE_NO_QUESTIONS: string =
  "--disallowedTools=AskUserQuestion,EnterPlanMode,ExitPlanMode --append-system-prompt 'You run unattended: nobody will answer questions. Never ask the user anything and never wait for confirmation; make the most reasonable decision, note the assumption, and carry on to the end.'";

const LAUNCH: Readonly<Record<Harness, HarnessLaunch>> = {
  copilot: { base: 'copilot --allow-all', promptFlag: '-i ' },
  claude: { base: `claude --dangerously-skip-permissions ${CLAUDE_NO_QUESTIONS}`, promptFlag: '' },
  agy: { base: 'agy --dangerously-skip-permissions', promptFlag: '-i ' },
  codex: { base: 'codex --dangerously-bypass-approvals-and-sandbox', promptFlag: '' },
};

/**
 * The shell command a session runs. The prompt itself never enters this string: the harness
 * receives it as one argument via `"$(cat file)"`, so quotes, backticks or a `$(` inside the
 * prompt stay text. The only interpolated value is the file path, which the API chose.
 */
export const buildHarnessCommand = (harness: Harness, promptFile: string): string => {
  const { base, promptFlag }: HarnessLaunch = LAUNCH[harness];
  return `${base} ${promptFlag}"$(cat ${shellQuote(promptFile)})"`;
};

export const harnessCommandBase = (harness: Harness): string => LAUNCH[harness].base;
