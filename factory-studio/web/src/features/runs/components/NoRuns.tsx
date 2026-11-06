/**
 * The harness has no runs at all. Not an error and not a misconfiguration — it is what a
 * fresh checkout looks like, so it says what makes a run and that the page picks the first
 * one up by itself: the server watches `run/` and pushes the new folder the moment it appears.
 * The app ships no demo data to fill the gap.
 */
export default function NoRuns() {
  return (
    <div className="no-runs" role="region" aria-label="No runs yet">
      <h2>No runs yet — run your first factory!</h2>
      <p>
        Start a pipeline skill — <code className="mono">/canonical-factory</code>, or any other
        factory of yours — and it records what it does under{' '}
        <code className="mono">run/&lt;pipeline&gt;/&lt;run-id&gt;/</code>. That folder is the whole
        of this dashboard: it draws the runs it finds there and nothing else.
      </p>
      <p className="muted">
        Nothing else to set up: this page is watching that folder, and your first run appears here
        on its own.
      </p>
    </div>
  );
}
