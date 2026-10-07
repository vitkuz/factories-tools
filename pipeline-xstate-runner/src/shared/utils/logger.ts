// Learned from factories-tools/pipeline-state/src/shared/utils/logger.ts
import { createLogger, format, transports, type Logger } from 'winston';
import env from '../config/env.js';

const LEVELS: string[] = ['error', 'warn', 'info', 'debug'];

const line = format.printf(({ timestamp, level, message, ...context }): string => {
  const tail = Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : '';
  return `${String(timestamp)} ${level.toUpperCase().padEnd(5)} ${String(message)}${tail}`;
});

/** The slice of a logger anything in this tool is allowed to depend on. Always injected. */
export interface LoggerPort {
  debug: (message: string, context?: Record<string, unknown>) => void;
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, context?: Record<string, unknown>) => void;
}

/**
 * Everything goes to stderr: stdout belongs to the command's result, so a pipe into `jq` never
 * meets a log line.
 */
export const logger: Logger = createLogger({
  level: env.LOG_LEVEL,
  format: format.combine(format.timestamp({ format: 'HH:mm:ss' }), line),
  transports: [new transports.Console({ stderrLevels: LEVELS })],
});

/** A logger that says nothing: for tests and for the inert replay machine. */
export const silentLogger: LoggerPort = {
  debug: (): void => undefined,
  info: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
};
