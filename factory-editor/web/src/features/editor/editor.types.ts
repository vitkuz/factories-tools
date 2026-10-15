import type { z } from 'zod';
import type {
  createdSchema,
  pipelineListEntrySchema,
  pipelineListSchema,
  savedSchema,
} from './editor.schema';

export type PipelineListEntry = z.infer<typeof pipelineListEntrySchema>;
export type PipelineList = z.infer<typeof pipelineListSchema>;
export type Saved = z.infer<typeof savedSchema>;
export type Created = z.infer<typeof createdSchema>;

/** Where the open pipeline stands against the file on disk. */
export type SaveState =
  | { status: 'clean' }
  | { status: 'dirty' }
  | { status: 'saving' }
  | { status: 'saved'; bytes: number }
  | { status: 'failed'; message: string; issues: string[] };

/** The load of the pipeline named by the route. */
export type LoadState =
  | { status: 'idle' }
  | { status: 'loading'; id: string }
  | { status: 'ready'; id: string }
  | { status: 'failed'; id: string; message: string };

export type ListState = 'loading' | 'ready' | 'failed';
