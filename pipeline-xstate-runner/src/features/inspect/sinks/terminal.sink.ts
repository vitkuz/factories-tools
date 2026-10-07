import type { InspectionEvent } from 'xstate';
import type { LoggerPort } from '../../../shared/utils/logger.js';
import type { InspectSink } from '../inspect.types.js';
import { describeInspection } from '../inspect.utils.js';

/** Every event and state change, one line each, on the logger (stderr). */
export const createTerminalSink =
  (logger: LoggerPort): InspectSink =>
  (event: InspectionEvent): void => {
    const line: string | undefined = describeInspection(event);
    if (line !== undefined) logger.info(line);
  };
