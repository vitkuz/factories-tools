import type { ReactNode } from 'react';
import type { FactorySession } from '../sessions.types';
import { formatClock } from '../../runs/lib/format';

interface SessionListProps {
  sessions: FactorySession[];
  /** The session whose Stop is in flight. */
  stopping: string | null;
  onStop: (session: string) => void;
}

/** Every running `factory-*` tmux session, oldest first, with a Stop per row. */
export const SessionList = ({ sessions, stopping, onStop }: SessionListProps): ReactNode => {
  if (sessions.length === 0)
    return <p className="muted sessions-empty">No factory session is running.</p>;
  return (
    <div className="grid-scroll">
      <table className="grid sessions-table">
        <thead>
          <tr>
            <th>Session</th>
            <th>Factory</th>
            <th>Harness</th>
            <th>Started</th>
            <th className="numeric">Age</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sessions.map((session: FactorySession) => (
            <tr key={session.session}>
              <td className="mono">{session.session}</td>
              <td className="mono muted">{session.factoryId}</td>
              <td className="muted">{session.harness}</td>
              <td className="muted nowrap">
                <time dateTime={session.startedAt} title={session.startedAt}>
                  {formatClock(session.startedAt)}
                </time>
              </td>
              <td className="numeric muted">{session.age}</td>
              <td className="numeric">
                <button
                  type="button"
                  className="danger-button"
                  disabled={stopping === session.session}
                  onClick={(): void => onStop(session.session)}
                >
                  {stopping === session.session ? 'Stopping…' : 'Stop'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
