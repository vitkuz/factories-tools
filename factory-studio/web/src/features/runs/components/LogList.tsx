import type { ReactNode } from 'react';
import { toLogEntry, type LogEntry } from '../lib/history';
import { formatOffset } from '../lib/format';
import type { HistoryEntry } from '../lib/types';

interface Props {
  logs: HistoryEntry[];
  startedAt: string | null | undefined;
  /** Step slugs in the pipeline — only these become clickable chips. */
  stepSlugs: readonly string[];
  onSelectStep: (slug: string) => void;
}

const QUOTED = /'([^']+)'/g;

/**
 * The message with the step name as a chip and the result slug as code. The chip
 * replaces the quoted token exactly, so no whitespace is added around it. A step named
 * again in a run of consecutive lines is rendered as plain text — one chip per group.
 */
const renderMessage = (
  entry: LogEntry,
  stepSlugs: readonly string[],
  chipStep: boolean,
  onSelectStep: (slug: string) => void,
): ReactNode[] => {
  const parts: ReactNode[] = [];
  let last: number = 0;
  for (const m of entry.message.matchAll(QUOTED)) {
    const index: number = m.index ?? 0;
    const token: string = m[1];
    parts.push(entry.message.slice(last, index));
    if (stepSlugs.includes(token) && token === entry.step && chipStep) {
      parts.push(
        <button
          key={`${index}-step`}
          type="button"
          className="log-step"
          onClick={() => onSelectStep(token)}
        >
          {token}
        </button>,
      );
    } else if (stepSlugs.includes(token)) {
      parts.push(
        <span key={`${index}-step-plain`} className="log-step-plain">
          {token}
        </span>,
      );
    } else if (token === entry.result) {
      parts.push(
        <code key={`${index}-result`} className="log-result">
          {token}
        </code>,
      );
    } else {
      parts.push(m[0]);
    }
    last = index + m[0].length;
  }
  parts.push(entry.message.slice(last));
  return parts;
};

export default function LogList({ logs, startedAt, stepSlugs, onSelectStep }: Props) {
  if (logs.length === 0) return <p className="muted hint">No log lines yet.</p>;
  const entries: LogEntry[] = logs.map(toLogEntry);
  return (
    <ol className="log" id="run-log">
      {entries.map((entry: LogEntry, i: number) => {
        const sameAsPrevious: boolean =
          i > 0 && entries[i - 1].step === entry.step && entry.step !== null;
        return (
          <li key={`${i}-${entry.at ?? ''}`} className="log-row">
            <span className="log-at" title={entry.at ?? undefined}>
              {formatOffset(startedAt, entry.at)}
            </span>
            <span className="log-msg">
              {renderMessage(entry, stepSlugs, !sameAsPrevious, onSelectStep)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
