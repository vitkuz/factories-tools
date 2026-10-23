import type { ReactNode } from 'react';

export type FeedTone = 'live' | 'unreachable';

export interface FeedBarProps {
  /** The sentence: "Updated 3 s ago", or the error when the data cannot be reached. */
  detail: string;
  /** One word for the indicator: Live, Offline, Connecting. */
  word: string;
  tone: FeedTone;
  /** The dot pulses while something is running or waiting. */
  active?: boolean;
  refreshing: boolean;
  refreshTitle?: string;
  onRefresh: () => void;
}

/**
 * The top bar's feed group, the same on every screen and at its far right: the sentence, the
 * live indicator and Refresh. Each feature passes its own wording and state.
 */
export const FeedBar = ({
  detail,
  word,
  tone,
  active = false,
  refreshing,
  refreshTitle,
  onRefresh,
}: FeedBarProps): ReactNode => {
  const dotClass: string = [
    'live-dot',
    `live-dot--${tone}`,
    tone === 'live' && active ? 'is-active' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="feed-bar">
      <span className="feed-detail">{detail}</span>
      <div className="live-status" role="status" aria-live="polite" title={detail}>
        <span className={dotClass} aria-hidden="true" />
        <span className="live-word">{word}</span>
      </div>
      <button
        type="button"
        className="feed-refresh"
        onClick={onRefresh}
        disabled={refreshing}
        title={refreshTitle}
      >
        {refreshing ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  );
};
