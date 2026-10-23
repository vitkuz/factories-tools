import type { ReactNode } from 'react';
import type { RunsFeed } from '../hooks/use-runs-feed';
import { useNow } from '../../../shared/lib/polling';
import { FeedBar, type FeedTone } from '../../../shared/components/FeedBar';
import { formatClock, formatRelative } from '../lib/format';

interface Copy {
  word: string;
  detail: string;
  tone: FeedTone;
  refreshTitle: string;
}

/** "1 run with an invalid state.json (content-pipeline/x)" for the bar. */
const droppedNote = (dropped: string[]): string =>
  `${dropped.length} run${dropped.length === 1 ? '' : 's'} with an invalid state.json (${dropped.join(', ')})`;

/** One word for the header, one sentence for the bar. Any error means Offline. */
export const describeFeed = (feed: RunsFeed, now: number): Copy => {
  if (feed.error) {
    return {
      word: 'Offline',
      detail: `Can't reach run data (${feed.error}). Showing what was loaded ${formatRelative(feed.updatedAt, now)}.`,
      tone: 'unreachable',
      refreshTitle: 'Try reaching the run data again',
    };
  }
  if (feed.source === 'live') {
    return {
      word: 'Live',
      detail: feed.invalid
        ? `Last update was invalid — showing data from ${formatRelative(feed.updatedAt, now)}`
        : feed.dropped.length > 0
          ? `Updated ${formatRelative(feed.updatedAt, now)}; hiding ${droppedNote(feed.dropped)}`
          : `Updated ${formatRelative(feed.updatedAt, now)}`,
      tone: 'live',
      refreshTitle: 'Fetch the current run data now',
    };
  }
  // Before the first answer: nothing on screen yet, the first fetch is in flight.
  return {
    word: 'Connecting',
    detail: `Connecting to the API (${formatClock(feed.updatedAt)})…`,
    tone: 'unreachable',
    refreshTitle: 'Fetch the current run data now',
  };
};

interface RunsFeedBarProps {
  feed: RunsFeed;
  /** True while the selected run is running or waiting — the dot pulses. */
  active: boolean;
}

/** The runs feed in the shared top-bar group: the sentence, the indicator, Refresh. */
export const RunsFeedBar = ({ feed, active }: RunsFeedBarProps): ReactNode => {
  const now: number = useNow(1000);
  const copy: Copy = describeFeed(feed, now);
  return (
    <FeedBar
      detail={copy.detail}
      word={copy.word}
      tone={copy.tone}
      active={active}
      refreshing={feed.refreshing}
      refreshTitle={copy.refreshTitle}
      onRefresh={feed.refresh}
    />
  );
};
