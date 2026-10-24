import path from 'node:path';
import { RUN_DIR } from '../runs/runs.utils.js';
import type { Workspace, WorkspacesFile } from './workspaces.types.js';

/** The one file, under `run/`: the run collector lists sub-folders only, so it never sees it. */
export const WORKSPACES_FILE = 'workspaces.json';

/** How errors and logs name the file: relative to `WORK_DIR`. */
export const WORKSPACES_FILE_LABEL = `${RUN_DIR}/${WORKSPACES_FILE}`;

const MAX_ID_LENGTH = 60;

export const workspacesFilePath = (workDir: string): string =>
  path.join(workDir, RUN_DIR, WORKSPACES_FILE);

/**
 * The id a new workspace gets from its name: lower case, every run of other characters one
 * `-`, no `-` at either end, at most 60 characters. A name with nothing usable is `workspace`.
 */
export const slugify = (name: string): string => {
  const slug: string = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ID_LENGTH)
    .replace(/-+$/, '');
  return slug === '' ? 'workspace' : slug;
};

/** Pretty JSON, 2 spaces, trailing newline: the same bytes a person would write by hand. */
export const formatWorkspacesFile = (file: WorkspacesFile): string =>
  `${JSON.stringify(file, null, 2)}\n`;

export const findWorkspace = (file: WorkspacesFile, id: string): Workspace | undefined =>
  file.workspaces.find((workspace: Workspace): boolean => workspace.id === id);

/** The file with `next` in place of the workspace with the same id, or appended when new. */
export const withWorkspace = (file: WorkspacesFile, next: Workspace): WorkspacesFile =>
  findWorkspace(file, next.id) === undefined
    ? { ...file, workspaces: [...file.workspaces, next] }
    : {
        ...file,
        workspaces: file.workspaces.map((workspace: Workspace): Workspace =>
          workspace.id === next.id ? next : workspace,
        ),
      };

export const withoutWorkspace = (file: WorkspacesFile, id: string): WorkspacesFile => ({
  ...file,
  workspaces: file.workspaces.filter((workspace: Workspace): boolean => workspace.id !== id),
});
