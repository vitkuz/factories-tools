import type { RunsFeed } from '../hooks/use-runs-feed';

interface Props {
  feed: RunsFeed;
}

/**
 * The harness has no runs at all. Not an error and not a misconfiguration — it is what a
 * fresh checkout looks like, so it says what makes a run and that the page picks the first
 * one up by itself. The app ships no demo data to fill the gap.
 */
export default function NoRuns({ feed }: Props) {
  const watching: string =
    'Nothing else to set up: this page is watching that folder, and your first run appears here on its own.';
  return (
    <div className="no-runs" role="region" aria-label="No runs yet">
      <h2>No runs yet — run your first factory!</h2>
      <p>
        Start a pipeline skill — <code className="mono">/canonical-factory</code>, or any other
        factory of yours — and it records what it does under{' '}
        <code className="mono">run/&lt;pipeline&gt;/&lt;run-id&gt;/</code>. That folder is the whole
        of this dashboard: it draws the runs it finds there and nothing else.
      </p>
      <p className="muted">{watching}</p>
      <div className="no-runs-actions">
        <button
          type="button"
          className="feed-refresh"
          onClick={feed.refresh}
          disabled={feed.refreshing}
        >
          {feed.refreshing ? 'Checking…' : 'Check again'}
        </button>
      </div>
    </div>
  );
}
