import type { ReactNode } from 'react';
import type { SessionNotice as Notice } from '../sessions.types';

interface SessionNoticeProps {
  notice: Notice | null;
  onDismiss: () => void;
}

/** What the last start or stop did, or why the API refused it. */
export const SessionNotice = ({ notice, onDismiss }: SessionNoticeProps): ReactNode => {
  if (!notice) return null;
  return (
    <div
      className={`sessions-notice is-${notice.tone}`}
      role={notice.tone === 'refusal' ? 'alert' : 'status'}
    >
      <div className="sessions-notice-body">
        <strong>{notice.title}</strong>
        {notice.lines.length > 0 ? (
          <ul>
            {notice.lines.map((line: string) => (
              <li key={line} className="mono">
                {line}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <button type="button" className="icon-button" title="dismiss" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
};
