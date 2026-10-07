import type { InspectionEvent } from 'xstate';
import type { FileSystemClient } from '../../../clients/file-system/types.js';
import type { InspectSink } from '../inspect.types.js';
import { inspectionLineOf } from '../inspect.utils.js';

/** Every inspection event of every actor, one JSON line each, in a file of the caller's choice. */
export const createJsonlSink =
  (fileSystem: FileSystemClient, file: string): InspectSink =>
  (event: InspectionEvent): void => {
    fileSystem.appendLine(file, JSON.stringify(inspectionLineOf(event)));
  };
