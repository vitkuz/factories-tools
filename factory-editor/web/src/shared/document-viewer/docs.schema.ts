import { z } from 'zod';

/** A directory listing answered by the dev/preview doc endpoint. */
export const dirEntrySchema = z.object({
  name: z.string(),
  type: z.enum(['file', 'directory']),
  size: z.number(),
});

export const directoryListingSchema = z.object({
  kind: z.literal('directory'),
  path: z.string(),
  entries: z.array(dirEntrySchema),
});

/** The endpoint's answer for a doc that has not been written yet (200, so the console stays clean). */
export const missingNoticeSchema = z.object({
  kind: z.literal('missing'),
  path: z.string(),
});

export type DirEntry = z.infer<typeof dirEntrySchema>;
export type DirectoryListing = z.infer<typeof directoryListingSchema>;
