import { describe, expect, it } from 'vitest';
import { buildHarnessCommand } from '../src/features/sessions/services/build-harness-command.service.js';

const APPENDED =
  'You run inside Factory Studio and may run unattended. Prefer the most reasonable decision: note the assumption and carry on to the end. Use AskUserQuestion only when a decision truly cannot be made without the person; the question is shown in the studio app, so ask clearly, once, and wait for the answer.';

describe('buildHarnessCommand', () => {
  const file = '/tmp/factory-studio/factory-research-7f3a9c2b.prompt';

  it.each([
    ['copilot', `copilot --allow-all -i "$(cat '${file}')"`],
    ['agy', `agy --dangerously-skip-permissions -i "$(cat '${file}')"`],
    ['codex', `codex --dangerously-bypass-approvals-and-sandbox "$(cat '${file}')"`],
  ] as const)('%s', (harness, expected: string) => {
    expect(buildHarnessCommand(harness, file)).toBe(expected);
  });

  it('claude: question tool left on, plan mode off, settings file and prompt before the prompt file', () => {
    const settings = '/tmp/factory-studio/factory-research-7f3a9c2b.settings.json';
    const command: string = buildHarnessCommand('claude', file, { settingsFile: settings });
    expect(command).toBe(
      `claude --dangerously-skip-permissions --settings '${settings}' --disallowedTools=EnterPlanMode,ExitPlanMode --append-system-prompt '${APPENDED}' "$(cat '${file}')"`,
    );
    expect(command).not.toContain('AskUserQuestion,');
    expect(buildHarnessCommand('claude', file)).not.toContain('--settings');
  });

  it('settings are for claude only', () => {
    expect(buildHarnessCommand('codex', file, { settingsFile: '/s.json' })).not.toContain(
      '/s.json',
    );
  });

  it('never carries the prompt text, only the file path', () => {
    const command: string = buildHarnessCommand('claude', file);
    expect(command).not.toContain('/research-factory');
    expect(command).toContain(file);
  });
});
