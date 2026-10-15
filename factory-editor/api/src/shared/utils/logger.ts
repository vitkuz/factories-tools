import { createLogger, format, transports, type Logger } from 'winston';
import env from '../config/env.js';

/** One JSON line per event, to stdout. */
export const logger: Logger = createLogger({
  level: env.LOG_LEVEL,
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});
