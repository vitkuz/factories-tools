import { z } from 'zod';

/**
 * Output basenames a subagent cannot create: Claude Code's Write tool refuses them inside a
 * subagent ("Subagents should return findings as text, not write report files"). Lowercase; the
 * check is case-insensitive.
 */
export const BlockedOutputNameSchema = z.enum([
  'summary.md',
  'report.md',
  'findings.md',
  'analysis.md',
]);
