import type { ReactNode } from 'react';

interface ErrorScreenProps {
  title: string;
  /** What went wrong, in one sentence. */
  detail: string;
  onRetry?: () => void;
}

/** Full-page error state: what failed, and a way to try again. */
export const ErrorScreen = ({ title, detail, onRetry }: ErrorScreenProps): ReactNode => (
  <div className="error-screen" role="alert">
    <h1>{title}</h1>
    <p>{detail}</p>
    {onRetry && (
      <button type="button" className="feed-refresh" onClick={onRetry}>
        Try again
      </button>
    )}
  </div>
);
