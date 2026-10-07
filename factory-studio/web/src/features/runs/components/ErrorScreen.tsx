import type { ParseIssue } from '../lib/dashboard.schema';

interface Props {
  title: string;
  /** What went wrong, in one sentence. */
  detail: string;
  issues?: ParseIssue[];
  /** Fix the reader can run. */
  command?: string;
  onRetry?: () => void;
}

/** Full-page error state: what failed, the first issues, and the command that fixes it. */
export default function ErrorScreen({ title, detail, issues = [], command, onRetry }: Props) {
  return (
    <div className="error-screen" role="alert">
      <h1>{title}</h1>
      <p>{detail}</p>
      {issues.length > 0 && (
        <ul className="error-issues">
          {issues.map((i: ParseIssue) => (
            <li key={`${i.path}:${i.message}`}>
              <code className="mono">{i.path}</code> {i.message}
            </li>
          ))}
        </ul>
      )}
      {command && (
        <p>
          Then run <code className="mono">{command}</code> and reload.
        </p>
      )}
      {onRetry && (
        <button type="button" className="feed-refresh" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
