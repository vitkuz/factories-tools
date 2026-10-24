import type { ReactNode } from 'react';
import { useWorkspaces, WorkspacesContext } from '../hooks/use-workspaces';
import type { Workspaces } from '../workspaces.types';

interface WorkspacesProviderProps {
  children: ReactNode;
}

/**
 * Reads the workspaces once for the whole app, so the top bar's picker, the sidebar, the Runs
 * home and the Sessions start form all filter by the same choice.
 */
export const WorkspacesProvider = ({ children }: WorkspacesProviderProps): ReactNode => {
  const workspaces: Workspaces = useWorkspaces();
  return <WorkspacesContext.Provider value={workspaces}>{children}</WorkspacesContext.Provider>;
};
