import type { AgentUsage, RunReport } from '../features/run/index.js';
import { createAppError } from '../shared/utils/error.utils.js';

/** Commander's collector for a repeatable `--param name=value`. */
export const collectParam = (
  entry: string,
  collected: Record<string, string>,
): Record<string, string> => {
  const at = entry.indexOf('=');
  if (at < 1) throw createAppError('PARAMS_INVALID', `--param takes name=value, got "${entry}"`);
  return { ...collected, [entry.slice(0, at).trim()]: entry.slice(at + 1) };
};

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

/** What runner.md asks the harness to tell the user at the end, read back from the record. */
export const formatReport = (report: RunReport): string =>
  [
    `${report.status === 'COMPLETED' ? '✔' : '✖'} ${report.status}  ${report.runId}`,
    `run folder   ${report.outputDir}`,
    `state        ${report.stateFile}`,
    ...(report.endedBy.length === 0 ? [] : [`ended by     ${report.endedBy.join(', ')}`]),
    ...(report.failure === undefined ? [] : [`stopped      ${report.failure}`]),
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
