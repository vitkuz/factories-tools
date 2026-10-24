import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import type { DashboardData } from '../../runs/runs.types';
import { useWorkspacesContext } from '../hooks/use-workspaces';
import { workspacePayloadSchema } from '../workspaces.schema';
import type {
  Workspace,
  WorkspaceOption,
  WorkspacePayload,
  Workspaces,
  WorkspaceWriteResult,
} from '../workspaces.types';
import { describeFactoryCount, factoryOptions } from '../workspaces.utils';

interface WorkspacesDialogProps {
  /** The run list's data: the factories on disk and the ones runs name. */
  data: DashboardData;
  onClose: () => void;
}

/** What the form is for: a new workspace, or the one with this id. */
type Target = { kind: 'new' } | { kind: 'edit'; id: string };

interface Draft {
  name: string;
  pipelines: string[];
}

const NEW: Target = { kind: 'new' };

const draftOf = (workspace: Workspace | null): Draft => ({
  name: workspace?.name ?? '',
  pipelines: workspace?.pipelines ?? [],
});

const workspaceOf = (target: Target, list: Workspace[]): Workspace | null =>
  target.kind === 'edit'
    ? (list.find((w: Workspace): boolean => w.id === target.id) ?? null)
    : null;

const firstTarget = (selected: Workspace | null, list: Workspace[]): Target => {
  const start: Workspace | undefined = selected ?? list[0];
  return start ? { kind: 'edit', id: start.id } : NEW;
};

/** The ticked ids in the options' order, so the file reads like the list. */
const toggled =
  (id: string, on: boolean) =>
  (pipelines: string[]): string[] =>
    on
      ? [...pipelines.filter((p: string): boolean => p !== id), id]
      : pipelines.filter((p: string): boolean => p !== id);

/**
 * Manage the workspaces: the list on the left (click one to edit it), the form on the right
 * (its name and a checkbox per factory), Save / Cancel, and Delete with a confirm step inside
 * the dialog. A native modal `<dialog>`: Escape and a click on the backdrop close it, focus
 * stays inside and goes back to Manage. The API's refusals are shown under the form.
 */
export const WorkspacesDialog = ({ data, onClose }: WorkspacesDialogProps): ReactNode => {
  const workspaces: Workspaces = useWorkspacesContext();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const [target, setTarget] = useState<Target>(() =>
    firstTarget(workspaces.selected, workspaces.list),
  );
  const editing: Workspace | null = workspaceOf(target, workspaces.list);
  const [draft, setDraft] = useState<Draft>(() => draftOf(editing));
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<boolean>(false);
  const options: WorkspaceOption[] = useMemo(
    (): WorkspaceOption[] => factoryOptions(editing, data),
    [editing, data],
  );
  const locked: boolean = workspaces.problem !== null;

  useEffect(() => {
    const dialog: HTMLDialogElement | null = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    document.documentElement.classList.add('has-modal');
    return () => document.documentElement.classList.remove('has-modal');
  }, []);

  const requestClose = (): void => {
    const dialog: HTMLDialogElement | null = dialogRef.current;
    if (dialog?.open) dialog.close();
    else onClose();
  };

  const open = (next: Target): void => {
    setTarget(next);
    setDraft(draftOf(workspaceOf(next, workspaces.list)));
    setError(null);
    setConfirming(false);
    if (next.kind === 'new') nameRef.current?.focus();
  };

  const finish = (result: WorkspaceWriteResult, after: (workspace: Workspace) => void): void => {
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    after(result.workspace);
  };

  const save = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (busy || locked) return;
    const parsed = workspacePayloadSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'the workspace is not valid');
      return;
    }
    const payload: WorkspacePayload = parsed.data;
    setBusy(true);
    const request: Promise<WorkspaceWriteResult> = editing
      ? workspaces.update(editing.id, payload)
      : workspaces.create(payload);
    void request.then((result: WorkspaceWriteResult): void =>
      finish(result, (workspace: Workspace): void => {
        setTarget({ kind: 'edit', id: workspace.id });
        setDraft(draftOf(workspace));
      }),
    );
  };

  const remove = (): void => {
    if (busy || locked || editing === null) return;
    const id: string = editing.id;
    setBusy(true);
    void workspaces.remove(id).then((result: WorkspaceWriteResult): void =>
      finish(result, (): void => {
        if (workspaces.selectedId === id) workspaces.select(null);
        const rest: Workspace[] = workspaces.list.filter((w: Workspace): boolean => w.id !== id);
        const next: Target = firstTarget(null, rest);
        setTarget(next);
        setDraft(draftOf(workspaceOf(next, rest)));
        setConfirming(false);
      }),
    );
  };

  const cancel = (): void => {
    setDraft(draftOf(editing));
    setError(null);
    setConfirming(false);
  };

  const onCancelEvent = (event: SyntheticEvent<HTMLDialogElement>): void => {
    // Escape first backs out of the delete confirm, then closes.
    if (confirming) {
      event.preventDefault();
      setConfirming(false);
    }
  };

  const title: string = editing ? `Edit ${editing.name}` : 'New workspace';

  return (
    <dialog
      ref={dialogRef}
      className="ws-dialog"
      aria-modal="true"
      aria-labelledby="ws-dialog-title"
      onCancel={onCancelEvent}
      onClose={onClose}
      onClick={(event: MouseEvent<HTMLDialogElement>): void => {
        if (event.target === dialogRef.current) requestClose();
      }}
    >
      <div className="ws-modal">
        <header className="doc-modal-head ws-modal-head">
          <h2 id="ws-dialog-title" className="ws-modal-title">
            Workspaces
          </h2>
          <span className="ws-modal-hint muted">
            A workspace shows only its factories: in the run list, on Runs and in Start.
          </span>
          <button type="button" className="doc-modal-btn" onClick={requestClose}>
            Close
          </button>
        </header>
        {locked ? (
          <p className="ws-problem" role="alert">
            run/workspaces.json cannot be read ({workspaces.problem}). Fix or remove it by hand;
            saving is off until then.
          </p>
        ) : null}
        <div className="ws-modal-body">
          <nav className="ws-list" aria-label="Workspaces">
            {workspaces.list.length === 0 ? (
              <p className="ws-empty muted">
                {workspaces.exists || locked
                  ? 'No workspaces.'
                  : 'No workspaces yet. Saving the first one creates run/workspaces.json.'}
              </p>
            ) : (
              <ul className="ws-list-rows">
                {workspaces.list.map((workspace: Workspace) => (
                  <li key={workspace.id}>
                    <button
                      type="button"
                      className="ws-list-row"
                      aria-current={editing?.id === workspace.id ? 'true' : undefined}
                      disabled={busy}
                      onClick={(): void => open({ kind: 'edit', id: workspace.id })}
                    >
                      <span className="ws-list-name">{workspace.name}</span>
                      <span className="ws-list-count mono">{describeFactoryCount(workspace)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className="doc-modal-btn ws-new"
              aria-pressed={target.kind === 'new'}
              disabled={busy}
              onClick={(): void => open(NEW)}
            >
              New workspace
            </button>
          </nav>
          <form className="ws-form" onSubmit={save} aria-label={title}>
            <h3 className="ws-form-title">{title}</h3>
            <label className="ws-field">
              <span className="ws-field-label">Name</span>
              <input
                ref={nameRef}
                className="input ws-name"
                type="text"
                value={draft.name}
                maxLength={80}
                placeholder="Klevrs"
                disabled={busy || locked}
                onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                  setDraft((d: Draft): Draft => ({ ...d, name: event.target.value }))
                }
              />
            </label>
            <fieldset className="ws-factories" disabled={busy || locked}>
              <legend className="ws-field-label">
                Factories <span className="mono muted">{draft.pipelines.length} ticked</span>
              </legend>
              {options.length === 0 ? (
                <p className="muted ws-empty">No factories known yet.</p>
              ) : (
                <ul className="ws-factory-rows">
                  {options.map((option: WorkspaceOption) => (
                    <li key={option.id}>
                      <label className={`ws-factory${option.onDisk ? '' : ' is-gone'}`}>
                        <input
                          type="checkbox"
                          checked={draft.pipelines.includes(option.id)}
                          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                            setDraft((d: Draft): Draft => ({
                              ...d,
                              pipelines: toggled(option.id, event.target.checked)(d.pipelines),
                            }))
                          }
                        />
                        <span className="mono">{option.id}</span>
                        {option.onDisk ? null : <span className="ws-tag">not on disk</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
            {error !== null ? (
              <p className="ws-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="ws-actions">
              {confirming && editing ? (
                <>
                  <span className="ws-confirm">
                    Delete {editing.name}? Its factories and runs stay.
                  </span>
                  <button
                    type="button"
                    className="doc-modal-btn ws-danger"
                    disabled={busy || locked}
                    onClick={remove}
                  >
                    {busy ? 'Deleting…' : 'Delete'}
                  </button>
                  <button
                    type="button"
                    className="doc-modal-btn"
                    disabled={busy}
                    onClick={(): void => setConfirming(false)}
                  >
                    Keep
                  </button>
                </>
              ) : (
                <>
                  {editing ? (
                    <button
                      type="button"
                      className="doc-modal-btn ws-danger ws-delete"
                      disabled={busy || locked}
                      onClick={(): void => setConfirming(true)}
                    >
                      Delete
                    </button>
                  ) : null}
                  <button type="button" className="doc-modal-btn" disabled={busy} onClick={cancel}>
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="doc-modal-btn is-primary"
                    disabled={busy || locked}
                  >
                    {busy ? 'Saving…' : editing ? 'Save' : 'Create'}
                  </button>
                </>
              )}
            </div>
          </form>
        </div>
      </div>
    </dialog>
  );
};
