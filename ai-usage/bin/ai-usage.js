#!/usr/bin/env node
import { runCli } from "../dist/cli/index.js";
import { logger } from "../dist/shared/utils/logger.js";

runCli(process.argv).catch((error) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
