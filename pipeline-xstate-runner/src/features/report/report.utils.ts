// Learned from factories-tools/pipeline-validation/src/features/report/report.utils.ts,
// factories-tools/pipeline-state/src/features/report/report.utils.ts (--list-guards) and
// factories-tools/pipeline-runner/src/cli/cli.utils.ts (the run report, the cost line)
import type { AgentUsage, HarnessClient } from '../../clients/harness/harness.types.js';
import type { GuardMeta } from '../machines/machines.guards.js';
import type { Finding } from '../pipeline/rules/rules.types.js';
import { messagesOf } from '../pipeline/services/validate-pipeline.service.js';
import type { ValidationReport } from '../pipeline/services/validate-pipeline.service.js';
import type { RunReport } from '../run/run.types.js';
import type { ReplayReport } from '../run/usecases/replay-run.usecase.js';

// --- validate ---------------------------------------------------------------------------------

const findingLine = (finding: Finding): string =>
  `${finding.severity}: ${finding.message}  [${finding.rule}]`;

/** The --json report: `errors` and `warnings` as plain text, `findings` with rule ids. */
export interface ValidationReportJson {
  ok: boolean;
  pipeline: string;
  errors: string[];
  warnings: string[];
  rulesRan: boolean;
  findings: Finding[];
}

export const toValidationJson = (report: ValidationReport): ValidationReportJson => ({
  ok: report.ok,
  pipeline: report.pipeline,
  errors: messagesOf('error')(report.findings),
  warnings: messagesOf('warning')(report.findings),
  rulesRan: report.rulesRan,
  findings: report.findings,
});

/**
 * Validating <file>
 * error: <message>  [rule-id]      errors first, then warnings
 * N error(s), M warning(s)
 */
export const formatValidation = (report: ValidationReport): string =>
  [
    `Validating ${report.pipeline}`,
    ...report.findings.filter((f: Finding): boolean => f.severity === 'error').map(findingLine),
    ...report.findings.filter((f: Finding): boolean => f.severity === 'warning').map(findingLine),
    ...(report.rulesRan ? [] : ['(graph rules not run: fix the errors above first)']),
    `${messagesOf('error')(report.findings).length} error(s), ${messagesOf('warning')(report.findings).length} warning(s)`,
  ].join('\n');

// --- run --------------------------------------------------------------------------------------

const list = (title: string, lines: readonly string[]): string[] =>
  lines.length === 0 ? [] : [title, ...lines.map((line: string): string => `  ${line}`)];

const count = (value: number): string => value.toLocaleString('en-US');

/**
 * Dollars where a harness named dollars, tokens and premium requests where it named those. A run
 * nobody priced is "not reported" — never `$0.00`, which would say it was free.
 */
export const formatCost = (costUsd: number, usage: AgentUsage): string => {
  const parts: string[] = [
    ...(costUsd > 0 ? [`$${costUsd.toFixed(2)}`] : []),
    ...(usage.inputTokens === undefined && usage.outputTokens === undefined
      ? []
      : [
          `${count(usage.inputTokens ?? 0)} tokens in${
            usage.cachedInputTokens === undefined
              ? ''
              : ` (${count(usage.cachedInputTokens)} cached)`
          }, ${count(usage.outputTokens ?? 0)} out`,
        ]),
    ...(usage.premiumRequests === undefined
      ? []
      : [`${Number(usage.premiumRequests.toFixed(2))} premium requests`]),
  ];
  return parts.length === 0 ? 'not reported' : parts.join(' · ');
};

const MARK: Readonly<Record<string, string>> = {
  COMPLETED: '✔',
  PAUSED: '⏸',
  ABORTED: '⏹',
};

/** What runner.md asks for at the end of a run, read back from the record. */
export const formatRunReport = (report: RunReport): string =>
  [
    `${MARK[report.status] ?? '✖'} ${report.status}  ${report.runId}`,
    `run folder   ${report.runDir}`,
    `state        ${report.stateFile}`,
    ...(report.endedBy.length === 0 ? [] : [`ended by     ${report.endedBy.join(', ')}`]),
    ...(report.failure === undefined ? [] : [`stopped      ${report.failure}`]),
    ...(report.awaiting === undefined
      ? []
      : [
          `waiting at   ${report.awaiting.step}: ${report.awaiting.ask.split('\n')[0] ?? ''}`,
          `answer with  xstate-runner answer ${report.runDir} ${report.awaiting.step} <${report.awaiting.events.join('|')}> [--note "…"]`,
        ]),
    `passes       ${Object.entries(report.passes)
      .map(([step, passes]: [string, number]): string => `${step}×${passes}`)
      .join('  ')}`,
    ...(report.harness === undefined ? [] : [`harness      ${report.harness}`]),
    `cost         ${formatCost(report.costUsd, report.usage)}`,
    ...list('deliverables', report.deliverables),
    ...list('caps that changed the route', report.capped),
    ...list(
      'skipped',
      report.skipped.map(({ step, reason }): string => `${step} — ${reason}`),
    ),
    ...list(
      'failed',
      report.failed.map(({ step, error }): string => `${step} — ${error}`),
    ),
    ...list(
      'hooks',
      report.hooks.map(
        ({ phase, command, exitCode }): string => `${phase} [exit ${exitCode}] ${command}`,
      ),
    ),
  ].join('\n');

export const formatReplay = (report: ReplayReport): string =>
  report.matches
    ? `replayed ${report.events} event(s): state.json reproduced exactly`
    : `replayed ${report.events} event(s): state.json DIFFERS from the rebuilt state`;

// --- lists ------------------------------------------------------------------------------------

/** --list-guards: every machine, then every named guard in the order it is written. */
export const formatGuards = (
  machines: readonly { machine: string; guards: readonly GuardMeta[] }[],
): string => {
  const width: number = Math.max(
    ...machines.flatMap(({ guards }) => guards.map((guard: GuardMeta): number => guard.id.length)),
  );
  return machines
    .map(({ machine, guards }): string =>
      [
        `${machine} machine`,
        ...guards.map(
          (guard: GuardMeta): string => `  ${guard.id.padEnd(width)}  ${guard.description}`,
        ),
      ].join('\n'),
    )
    .join('\n\n');
};

/** --list-harnesses: every installed harness and what it can do natively. */
export const formatHarnesses = (harnesses: Readonly<Record<string, HarnessClient>>): string =>
  Object.keys(harnesses)
    .sort()
    .map((name: string): string => {
      const { capabilities } = harnesses[name] as HarnessClient;
      const flags: string[] = (
        ['systemPrompt', 'structuredOutput', 'resume', 'customAgents', 'costUsd'] as const
      ).map((key): string => `${key}=${capabilities[key] ? 'yes' : 'no'}`);
      return `${name.padEnd(10)} ${flags.join(' ')}  permissionModes: ${capabilities.permissionModes.join(', ')}`;
    })
    .join('\n');

/** What a command prints on stdout when asked for JSON: two-space JSON. */
export const formatJson = (value: unknown): string => JSON.stringify(value, null, 2);
