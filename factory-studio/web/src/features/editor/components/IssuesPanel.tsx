import type { ReactNode } from 'react';
import type { Issue, Selection } from '../lib/pipeline.types';

interface IssuesPanelProps {
  issues: Issue[];
  onSelect: (selection: Selection | null) => void;
}

export const IssuesPanel = ({ issues, onSelect }: IssuesPanelProps): ReactNode => (
  <section className="issues">
    <h2 className="panel-heading">
      Checks
      <em className="field-hint">
        mirrors the kit's validator (factories-tools/bin/validate.mjs) — that CLI is still the gate
      </em>
    </h2>
    {issues.length === 0 ? (
      <p className="empty">No errors, no warnings.</p>
    ) : (
      <ul className="issue-list">
        {issues.map((issue: Issue, index: number) => (
          // eslint-disable-next-line react/no-array-index-key -- issues are positional and may repeat
          <li key={index} className={`issue issue-${issue.level}`}>
            <button
              type="button"
              className="issue-button"
              disabled={issue.subject === undefined}
              onClick={(): void =>
                onSelect(
                  issue.subject ? { kind: 'step', name: issue.subject } : { kind: 'pipeline' },
                )
              }
            >
              <span className="issue-where mono">{issue.where}</span>
              <span className="issue-message">{issue.message}</span>
            </button>
          </li>
        ))}
      </ul>
    )}
  </section>
);
