import type { ReactNode } from 'react';

export type FeedTone = 'live' | 'unreachable';

export interface FeedBarProps {
  /** One word for the indicator: Live, Offline, Connecting. */
  word: string;
  tone: FeedTone;
  /** The dot pulses while something is running or waiting. */
  active?: boolean;
  /** What the indicator means right now, as the tooltip. */
  title?: string;
}

/**
 * The top bar's feed group, the same on every screen and at its far right: the live indicator
 * alone. There is no "updated n s ago" and nothing to press: the server pushes every change
 * over the socket, a dropped socket reconnects on its own, and the run's own times are data on
 * the run page. Each feature passes its own word.
 */
export const FeedBar = ({ word, tone, active = false, title }: FeedBarProps): ReactNode => {
  const dotClass: string = [
    'live-dot',
    `live-dot--${tone}`,
    tone === 'live' && active ? 'is-active' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="feed-bar">
      <div className="live-status" role="status" aria-live="polite" title={title}>
        <span className={dotClass} aria-hidden="true" />
        <span className="live-word">{word}</span>
      </div>
    </div>
  );
};
