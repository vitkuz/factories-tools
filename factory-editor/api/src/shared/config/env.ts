import 'dotenv/config';
import { z, type ZodSafeParseResult } from 'zod';
import { DEFAULT_WEB_DIST, REPO_ROOT } from './paths.js';

/**
 * The process environment, checked once at startup. A bad value is a setup mistake and stops
 * the server before it listens, with a line naming the variable and no stack.
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3150),
  /** Loopback unless someone deliberately says otherwise (BR43). */
  HOST: z.string().min(1).default('127.0.0.1'),
  /** Optional. When set, every /api/v1 route needs a matching x-api-key (BR46). */
  API_KEY: z.string().min(16, 'API_KEY must be at least 16 characters').optional(),
  /** Where factories/, factories.local/, .claude/skills/, knowledge/ and scripts/ live. */
  WORK_DIR: z.string().min(1).default(REPO_ROOT),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  /** The built app served at `/`. */
  WEB_DIST: z.string().min(1).default(DEFAULT_WEB_DIST),
});

export type Env = z.infer<typeof envSchema>;

const parsed: ZodSafeParseResult<Env> = envSchema.safeParse(process.env);
if (!parsed.success) {
  for (const issue of parsed.error.issues) {
    console.error(`invalid environment: ${String(issue.path[0] ?? '?')}: ${issue.message}`);
  }
  process.exit(1);
}

const env: Env = parsed.data;

export default env;
