import { z } from 'zod';
import 'dotenv/config';
import {
  harnessSchema,
  permissionModeSchema,
  tierMapSchema,
} from '../../features/harness/harness.schema.js';

const envSchema = z.object({
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  // Which harness runs the steps; `--harness` overrides it for one run.
  PIPELINE_HARNESS: harnessSchema.default('claude'),
  CLAUDE_BIN: z.string().min(1).default('claude'),
  CODEX_BIN: z.string().min(1).default('codex'),
  COPILOT_BIN: z.string().min(1).default('copilot'),
  AGY_BIN: z.string().min(1).default('agy'),
  // One setting for every harness. CLAUDE_PERMISSION_MODE is its older name and still read.
  PIPELINE_PERMISSION_MODE: permissionModeSchema.optional(),
  CLAUDE_PERMISSION_MODE: permissionModeSchema.default('bypassPermissions'),
  STEP_TIMEOUT_MINUTES: z.coerce.number().min(1).default(90),
  // `model` in pipeline.json is a tier; these say which model a tier means on each harness.
  CLAUDE_MODELS: tierMapSchema,
  CODEX_MODELS: tierMapSchema,
  COPILOT_MODELS: tierMapSchema,
  AGY_MODELS: tierMapSchema,
  // The model for a step that names none. Unset: the harness default runs.
  PIPELINE_DEFAULT_MODEL: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

// Validate process.env
const env: Env = envSchema.parse(process.env);

export default env;
