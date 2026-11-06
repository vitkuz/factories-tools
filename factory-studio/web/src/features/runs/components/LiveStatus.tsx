import type { ReactNode } from 'react';
import type { RunsFeed } from '../hooks/use-runs-feed';
import { FeedBar, type FeedTone } from '../../../shared/components/FeedBar';

interface Copy {
  word: string;
  tone: FeedTone;
  /** The tooltip: what the word means right now. */
  title: string;
}

/** "1 run with an invalid state.json (content-pipeline/x)" for the tooltip. */
const droppedNote = (dropped: string[]): string =>
  `${dropped.length} run${dropped.length === 1 ? '' : 's'} with an invalid state.json (${dropped.join(', ')})`;

/**
 * One word for the indicator. The socket decides: closed is Offline (the data on screen stays,
 * the reconnect is automatic), open without a snapshot yet is Connecting, open with one is
 * Live. Pure.
 */
export const describeFeed = (
  feed: Pick<RunsFeed, 'connection' | 'settled' | 'source' | 'invalid' | 'dropped'>,
): Copy => {
  if (feed.connection === 'closed') {
    return {
      word: 'Offline',
      tone: 'unreachable',
      title:
        feed.source === 'live'
          ? 'Disconnected, reconnecting… The last data stays on screen.'
          : 'Disconnected, reconnecting…',
    };
  }
  if (!feed.settled && feed.source !== 'live') {
    return { word: 'Connecting', tone: 'unreachable', title: 'Waiting for the run list…' };
  }
  return {
    word: 'Live',
    tone: 'live',
    title: feed.invalid
      ? 'The last run list was invalid; the previous one stays on screen.'
      : feed.dropped.length > 0
        ? `Changes arrive over the socket; hiding ${droppedNote(feed.dropped)}`
        : 'Changes arrive over the socket as the runs write them.',
  };
};

interface RunsFeedBarProps {
  feed: RunsFeed;
  /** True while the selected run is running or waiting — the dot pulses. */
  active: boolean;
}

/** The runs feed in the shared top-bar group: the indicator. */
export const RunsFeedBar = ({ feed, active }: RunsFeedBarProps): ReactNode => {
  const copy: Copy = describeFeed(feed);
  return <FeedBar word={copy.word} tone={copy.tone} active={active} title={copy.title} />;
};
