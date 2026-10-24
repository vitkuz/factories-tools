import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  describeApiError,
  isApiError,
  toApiError,
  type ApiError,
} from '../../../adapters/http/api-error.utils';
import {
  createWorkspace,
  listWorkspaces,
  removeWorkspace,
  updateWorkspace,
} from '../../../adapters/http/studio-api.adapter';
import { readJson, writeJson } from '../../../shared/lib/storage';
import type {
  Workspace,
  WorkspacePayload,
  Workspaces,
  WorkspacesContextValue,
  WorkspacesList,
  WorkspacesState,
  WorkspaceWriteResult,
} from '../workspaces.types';
import { pickWorkspace, withoutWorkspace, withWorkspace } from '../workspaces.utils';

/** The chosen workspace, per browser. */
export const SELECTION_KEY = 'studio.workspace';

interface SelectionPrefs {
  id: string | null;
}

/** Query key of a link that opens the app on a workspace: `?ws=klevrs` (`?ws=` is All). */
const QUERY_KEY = 'ws';

const readStored = (): string | null => {
  const id: unknown = readJson<SelectionPrefs>(SELECTION_KEY, { id: null }).id;
  return typeof id === 'string' && id !== '' ? id : null;
};

/**
 * The workspace to start on: the one a link names in `?ws=`, which is then remembered like a
 * pick in the select, else the remembered one. The query is read once, on load.
 */
const readSelection = (): string | null => {
  const fromLink: string | null = new URLSearchParams(window.location.search).get(QUERY_KEY);
  if (fromLink === null) return readStored();
  const id: string | null = fromLink === '' ? null : fromLink;
  writeJson(SELECTION_KEY, { id });
  return id;
};

const asMessage = (error: unknown): string => {
  const apiError: ApiError = isApiError(error) ? error : toApiError(error);
  return describeApiError(apiError);
};

/**
 * The workspaces: listed on mount and after every write, the chosen one kept in localStorage.
 * A chosen id that is no longer listed reads as All without being forgotten, so a workspace
 * that comes back (the file fixed by hand) is chosen again.
 */
export const useWorkspaces = (): Workspaces => {
  const [state, setState] = useState<WorkspacesState>({
    list: [],
    exists: false,
    problem: null,
    loading: true,
    error: null,
  });
  const [selectedId, setSelectedId] = useState<string | null>(readSelection);
  const inflight = useRef<AbortController | null>(null);

  const refresh = useCallback((): void => {
    inflight.current?.abort();
    const controller: AbortController = new AbortController();
    inflight.current = controller;
    listWorkspaces(controller.signal)
      .then((answer: WorkspacesList): void => {
        if (controller.signal.aborted) return;
        inflight.current = null;
        setState({
          list: answer.workspaces,
          exists: answer.exists,
          problem: answer.problem ?? null,
          loading: false,
          error: null,
        });
      })
      .catch((error: unknown): void => {
        if (controller.signal.aborted) return;
        inflight.current = null;
        setState((s: WorkspacesState): WorkspacesState => ({
          ...s,
          loading: false,
          error: asMessage(error),
        }));
      });
  }, []);

  useEffect(() => {
    refresh();
    return () => inflight.current?.abort();
  }, [refresh]);

  const select = useCallback((id: string | null): void => {
    setSelectedId(id);
    writeJson(SELECTION_KEY, { id });
  }, []);

  /** Puts the written workspace in the list at once, then reads the file again. */
  const write = useCallback(
    async (
      run: () => Promise<Workspace>,
      apply: (workspace: Workspace) => (list: Workspace[]) => Workspace[],
    ): Promise<WorkspaceWriteResult> => {
      try {
        const workspace: Workspace = await run();
        setState((s: WorkspacesState): WorkspacesState => ({
          ...s,
          list: apply(workspace)(s.list),
          exists: true,
        }));
        refresh();
        return { ok: true, workspace };
      } catch (error: unknown) {
        return { ok: false, message: asMessage(error) };
      }
    },
    [refresh],
  );

  const create = useCallback(
    (payload: WorkspacePayload): Promise<WorkspaceWriteResult> =>
      write((): Promise<Workspace> => createWorkspace(payload), withWorkspace),
    [write],
  );

  const update = useCallback(
    (id: string, payload: WorkspacePayload): Promise<WorkspaceWriteResult> =>
      write((): Promise<Workspace> => updateWorkspace(id, payload), withWorkspace),
    [write],
  );

  const remove = useCallback(
    (id: string): Promise<WorkspaceWriteResult> =>
      write(
        (): Promise<Workspace> => removeWorkspace(id),
        (workspace: Workspace) => withoutWorkspace(workspace.id),
      ),
    [write],
  );

  const selected: Workspace | null = pickWorkspace(selectedId)(state.list);

  // One object per change, so the context's readers re-render only when something moved.
  return useMemo(
    (): Workspaces => ({ ...state, selected, selectedId, select, refresh, create, update, remove }),
    [state, selected, selectedId, select, refresh, create, update, remove],
  );
};

/** The app's one set of workspaces, provided by `WorkspacesProvider`. */
export const WorkspacesContext = createContext<WorkspacesContextValue | null>(null);

/** The workspaces and the chosen one; only inside `WorkspacesProvider`. */
export const useWorkspacesContext = (): WorkspacesContextValue => {
  const value: WorkspacesContextValue | null = useContext(WorkspacesContext);
  if (value === null) throw new Error('useWorkspacesContext is used outside WorkspacesProvider');
  return value;
};
