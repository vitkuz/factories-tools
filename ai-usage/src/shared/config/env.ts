import { z } from "zod";
import "dotenv/config";
import os from "node:os";
import path from "node:path";

const home = os.homedir();

const envSchema = z.object({
  AI_USAGE_HOME: z.string().default(path.join(home, ".ai-usage")),
  CLAUDE_CONFIG_DIR: z.string().default(path.join(home, ".claude")),
  CODEX_HOME: z.string().default(path.join(home, ".codex")),
  COPILOT_HOME: z.string().default(path.join(home, ".copilot")),
  ANTIGRAVITY_HOME: z.string().default(path.join(home, ".gemini", "antigravity-cli")),
  PYTHON_BIN: z.string().default("python3"),
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
});

export type Env = z.infer<typeof envSchema>;

const env: Env = envSchema.parse(process.env);

export default env;
