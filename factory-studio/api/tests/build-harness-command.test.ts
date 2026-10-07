import { describe, expect, it } from 'vitest';
import { buildHarnessCommand } from '../src/features/sessions/services/build-harness-command.service.js';

describe('buildHarnessCommand', () => {
  const file = '/tmp/factory-studio/factory-research-7f3a9c2b.prompt';

  it.each([
    ['copilot', `copilot --allow-all -i "$(cat '${file}')"`],
    [
      'claude',
      `claude --dangerously-skip-permissions --disallowedTools=AskUserQuestion,EnterPlanMode,ExitPlanMode --append-system-prompt 'You run unattended: nobody will answer questions. Never ask the user anything and never wait for confirmation; make the most reasonable decision, note the assumption, and carry on to the end.' "$(cat '${file}')"`,
    ],
    ['agy', `agy --dangerously-skip-permissions -i "$(cat '${file}')"`],
    ['codex', `codex --dangerously-bypass-approvals-and-sandbox "$(cat '${file}')"`],
  ] as const)('%s', (harness, expected: string) => {
    expect(buildHarnessCommand(harness, file)).toBe(expected);
  });

  it('never carries the prompt text, only the file path', () => {
    const command: string = buildHarnessCommand('claude', file);
    expect(command).not.toContain('/research-factory');
    expect(command).toContain(file);
  });
});
