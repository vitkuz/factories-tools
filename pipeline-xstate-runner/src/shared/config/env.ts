// Learned from factories-tools/run-state/src/shared/config/env.ts and factories-tools/pipeline-runner/src/shared/config/env.ts
import { z } from 'zod';
import { config } from 'dotenv';

// quiet: stdout belongs to the command's result.
config({ quiet: true });

const envSchema = z.object({
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  /** Recorded in the PIPELINE_INIT entry of a new run; empty when no harness set it. */
  CLAUDE_SESSION_ID: z.string().default(''),
  /** The harness binary. */
  CLAUDE_BIN: z.string().min(1).default('claude'),
  /** Which harness runs the steps; `--harness` overrides it for one run. */
  PIPELINE_HARNESS: z.string().min(1).default('claude'),
  /** How headless steps answer permission prompts; `--permission-mode` overrides it. */
  PIPELINE_PERMISSION_MODE: z.string().min(1).default('bypassPermissions'),
  /** The model for a step that names none; `--default-model` overrides it. */
  PIPELINE_DEFAULT_MODEL: z.string().min(1).optional(),
  /** One step may run this long before it is killed; `--step-timeout` overrides it. */
  STEP_TIMEOUT_MINUTES: z.coerce.number().min(1).default(90),
});

export type Env = z.infer<typeof envSchema>;

// Validate process.env
const env: Env = envSchema.parse(process.env);

export default env;
