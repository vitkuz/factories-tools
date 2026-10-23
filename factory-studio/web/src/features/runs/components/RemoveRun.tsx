import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';

/** A bin, drawn in the current colour. */
const TrashIcon = (): ReactNode => (
  <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path
      d="M6 2.5h4M2.5 4.5h11M4 4.5l.7 8.6a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.6M6.7 7v4.5M9.3 7v4.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

interface RemoveRunButtonProps {
  runId: string;
  /** The confirm for this run is open. */
  open: boolean;
  id: string;
  onOpen: () => void;
}

/** The bin at the end of a run row. It opens the confirm and never the run. */
export const RemoveRunButton = ({ runId, open, id, onOpen }: RemoveRunButtonProps): ReactNode => (
  <button
    type="button"
    id={id}
    className="row-remove"
    aria-label={`Remove run ${runId}`}
    aria-expanded={open}
    title="Remove run (moves it to run/.trash)"
    onClick={(event: MouseEvent<HTMLButtonElement>): void => {
      // The row opens the run on click; the bin must not.
      event.stopPropagation();
      onOpen();
    }}
  >
    <TrashIcon />
  </button>
);

interface RemoveRunConfirmProps {
  runId: string;
  pipelineId: string;
  /** The state says running: the run is dead if its session is gone, else the API refuses. */
  active: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** The in-row confirm: what the remove does, a warning for a run that says running, the API's refusal. */
export const RemoveRunConfirm = ({
  runId,
  pipelineId,
  active,
  busy,
  error,
  onConfirm,
  onCancel,
}: RemoveRunConfirmProps): ReactNode => {
  const confirmRef: RefObject<HTMLButtonElement | null> = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);
  return (
    <div
      className="run-remove-confirm"
      role="group"
      aria-label={`Remove run ${runId}`}
      onClick={(event: MouseEvent<HTMLDivElement>): void => event.stopPropagation()}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>): void => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="run-remove-text">
        <p>
          Remove <span className="mono">{runId}</span>? The folder moves to{' '}
          <span className="mono">run/.trash/{pipelineId}/</span> and leaves this list; moving it
          back restores it.
        </p>
        {active ? (
          <p className="run-remove-warning">
            This run says running. If its session is gone it is a dead run and can go; if a session
            is still in it, the remove is refused.
          </p>
        ) : null}
        {error !== null ? (
          <p className="run-remove-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="run-remove-actions">
        <button
          type="button"
          ref={confirmRef}
          className="danger-button"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? 'Moving…' : 'Move to trash'}
        </button>
        <button type="button" className="ghost-button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
};
