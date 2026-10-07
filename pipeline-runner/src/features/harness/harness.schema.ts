import { z } from 'zod';
import { modelSchema } from '../pipeline/pipeline.schema.js';

/** The harnesses a step can run on. Each one is an adapter behind the same AgentPort. */
export const harnessSchema = z.enum(['claude', 'codex', 'copilot', 'agy']);

/**
 * One runner-level setting, named the way Claude Code names its modes. Every adapter maps it to
 * its own flags, and refuses a mode it has no honest equivalent for.
 */
export const permissionModeSchema = z.enum([
  'acceptEdits',
  'auto',
  'bypassPermissions',
  'manual',
  'dontAsk',
  'plan',
]);

const tierMapObjectSchema = z.partialRecord(modelSchema, z.string().min(1));

const toPairs = (text: string): [string, string][] =>
  text
    .split(/[,\s]+/)
    .filter((entry: string): boolean => entry !== '')
    .map((entry: string): [string, string] => {
      const at = entry.indexOf('=');
      return [entry.slice(0, Math.max(at, 0)), entry.slice(at + 1)];
    });

/**
 * `model` in pipeline.json is a tier. One env value per harness says which of its models each
 * tier means: `opus=gpt-6-astra,haiku=gpt-5.6-luna`. Empty by default: an unmapped tier passes no
 * model flag, and the harness default runs.
 */
export const tierMapSchema = z
  .string()
  .default('')
  .transform((text: string): Record<string, string> => Object.fromEntries(toPairs(text)))
  .pipe(tierMapObjectSchema);
