import { useCallback, useEffect, useState } from 'react';
import { removeRun } from '../../../adapters/http/studio-api.adapter';
import { navigate, parseRoute, type Route, type RunRef } from '../../../shared/lib/route';
import type { RunsFeed } from './use-runs-feed';
import type { RemoveRunOutcome, RemovedRun } from '../runs.types';
import { removeFailureOf } from '../runs.utils';

/** How long the "moved to trash" line stays. */
const NOTICE_MS = 8_000;

export interface RunRemover {
  /** Moves the run to `run/.trash`; on success the row is gone from the feed at once. */
  remove: (ref: RunRef) => Promise<RemoveRunOutcome>;
  /** The last run removed here, while its notice is on screen. */
  removed: RemovedRun | null;
  dismiss: () => void;
}

const isOpen = (ref: RunRef): boolean => {
  const route: Route = parseRoute(window.location.pathname);
  return (
    route.screen === 'runs' &&
    route.run !== null &&
    route.run.pipelineId === ref.pipelineId &&
    route.run.runId === ref.runId
  );
};

/**
 * Remove = move to trash (E15). The row leaves the feed as soon as the API answers, then the
 * feed is fetched again so every number around it is recounted; a run open on the run page
 * sends the page back to the runs home.
 */
export const useRemoveRun = (feed: Pick<RunsFeed, 'forget' | 'refresh'>): RunRemover => {
  const { forget, refresh }: Pick<RunsFeed, 'forget' | 'refresh'> = feed;
  const [removed, setRemoved] = useState<RemovedRun | null>(null);

  useEffect(() => {
    if (removed === null) return;
    const timer: number = window.setTimeout(() => setRemoved(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [removed]);

  const remove = useCallback(
    async (ref: RunRef): Promise<RemoveRunOutcome> => {
      try {
        const done: RemovedRun = await removeRun(ref);
        forget(ref);
        refresh();
        setRemoved(done);
        if (isOpen(ref)) navigate({ screen: 'runs', run: null });
        return { ok: true, removed: done };
      } catch (error: unknown) {
        return removeFailureOf(error);
      }
    },
    [forget, refresh],
  );

  const dismiss = useCallback((): void => setRemoved(null), []);
  return { remove, removed, dismiss };
};
