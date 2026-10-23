// Copied from factories-tools/pipeline-validation/src/shared/config/env.ts, plus the harness session id.
import { z } from 'zod';
import { config } from 'dotenv';

// quiet: stdout belongs to the command's JSON.
config({ quiet: true });

const envSchema = z.object({
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  /** Recorded in the PIPELINE_INIT entry of a new run; empty when the harness does not set it. */
  CLAUDE_SESSION_ID: z.string().default(''),
  /** What Claude Code itself sets in every Bash command; the fallback for CLAUDE_SESSION_ID. */
  CLAUDE_CODE_SESSION_ID: z.string().default(''),
});

export type Env = z.infer<typeof envSchema>;

// Validate process.env
const env: Env = envSchema.parse(process.env);

export default env;
