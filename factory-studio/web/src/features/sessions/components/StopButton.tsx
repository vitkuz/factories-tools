import type { ReactNode } from 'react';

interface StopButtonProps {
  stopping: boolean;
  onStop: () => void;
}

/** Stops the session; disabled while its stop is in flight. */
export const StopButton = ({ stopping, onStop }: StopButtonProps): ReactNode => (
  <button type="button" className="danger-button" disabled={stopping} onClick={onStop}>
    {stopping ? 'Stopping…' : 'Stop'}
  </button>
);
