import type { RunsFeed } from '../hooks/use-runs-feed';
import { useNow } from '../../../shared/lib/polling';
import { formatClock, formatRelative } from '../lib/format';

type Tone = 'live' | 'unreachable';

interface Copy {
  word: string;
  detail: string;
  tone: Tone;
  refreshTitle: string;
}

/** "1 run with an invalid state.json (content-pipeline/x)" for the footer. */
const droppedNote = (dropped: string[]): string =>
  `${dropped.length} run${dropped.length === 1 ? '' : 's'} with an invalid state.json (${dropped.join(', ')})`;

/** One word for the header, one sentence for the footer. Any error means Offline. */
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

interface Props {
  feed: RunsFeed;
  /** True while the selected run is running or waiting — the dot pulses. */
  active: boolean;
}

/** Header indicator: a dot and one word. */
export default function LiveStatus({ feed, active }: Props) {
  const now: number = useNow(1000);
  const copy: Copy = describeFeed(feed, now);
  const dotClass: string = [
    'live-dot',
    `live-dot--${copy.tone}`,
    copy.tone === 'live' && active ? 'is-active' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="live-status" role="status" aria-live="polite" title={copy.detail}>
      <span className={dotClass} aria-hidden="true" />
      <span className="live-word">{copy.word}</span>
    </div>
  );
}

/** Footer strip under the inspector: the sentence and the Refresh button. */
export function FeedFooter({ feed }: { feed: RunsFeed }) {
  const now: number = useNow(1000);
  const copy: Copy = describeFeed(feed, now);
  return (
    <footer className="feed-footer">
      <span className="feed-detail">{copy.detail}</span>
      <button
        type="button"
        className="feed-refresh"
        onClick={feed.refresh}
        disabled={feed.refreshing}
        title={copy.refreshTitle}
      >
        {feed.refreshing ? 'Refreshing…' : 'Refresh'}
      </button>
    </footer>
  );
}
