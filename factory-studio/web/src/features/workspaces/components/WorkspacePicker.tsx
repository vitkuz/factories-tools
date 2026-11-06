import { useState, type ChangeEvent, type ReactNode } from 'react';
import type { DashboardData } from '../../runs/runs.types';
import { useWorkspacesContext } from '../hooks/use-workspaces';
import type { Workspace, Workspaces } from '../workspaces.types';
import { WorkspacesDialog } from './WorkspacesDialog';

interface WorkspacePickerProps {
  /** The run list's data: the factories the dialog offers come from it. */
  data: DashboardData;
  /** A visible label before the select (the Runs page's "Factory"); hidden when absent. */
  label?: string;
  /** Extra class on the wrapper, for where it sits (`workspace-picker--bar` in a factory bar). */
  className?: string;
}

/**
 * The factory bar's workspace control (Runs and Sessions): a select (All factories, then each workspace) that filters
 * the sidebar, the Runs home and the Sessions start form, and Manage, which opens the dialog.
 * An unreadable `run/workspaces.json` or an unreachable API is flagged beside it.
 */
export const WorkspacePicker = ({ data, label, className }: WorkspacePickerProps): ReactNode => {
  const workspaces: Workspaces = useWorkspacesContext();
  const [open, setOpen] = useState<boolean>(false);
  const flag: string | null = workspaces.problem
    ? `run/workspaces.json cannot be read: ${workspaces.problem}`
    : workspaces.error
      ? `Can't read the workspaces: ${workspaces.error}`
      : null;

  return (
    <div className={['workspace-picker', className ?? ''].filter(Boolean).join(' ')}>
      <label className={label ? 'kicker' : 'visually-hidden'} htmlFor="workspace-select">
        {label ?? 'Workspace'}
      </label>
      <select
        id="workspace-select"
        className="control workspace-select"
        value={workspaces.selected?.id ?? ''}
        disabled={workspaces.loading && workspaces.list.length === 0}
        title={
          workspaces.selected
            ? `Workspace ${workspaces.selected.name}: only its factories are shown`
            : 'Every factory is shown'
        }
        onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
          workspaces.select(event.target.value === '' ? null : event.target.value)
        }
      >
        <option value="">All factories</option>
        {workspaces.list.map((workspace: Workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
          </option>
        ))}
      </select>
      {flag !== null ? (
        <span className="workspace-flag" title={flag} role="status">
          <span aria-hidden="true">⚠</span>{' '}
          {workspaces.problem ? 'workspaces.json unreadable' : 'workspaces unavailable'}
        </span>
      ) : null}
      <button
        type="button"
        className="btn btn--bar workspace-manage"
        onClick={(): void => setOpen(true)}
        title="Create, edit or delete workspaces"
      >
        Manage
      </button>
      {open ? <WorkspacesDialog data={data} onClose={(): void => setOpen(false)} /> : null}
    </div>
  );
};
