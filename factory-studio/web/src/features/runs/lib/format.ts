/** "just now", "4 s ago", "3 min ago", "2 h ago" — for the live indicator. */
export const formatRelative = (fromMs: number, nowMs: number): string => {
  const delta: number = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (delta < 3) return 'just now';
  if (delta < 60) return `${delta} s ago`;
  const minutes: number = Math.floor(delta / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours: number = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days: number = Math.floor(hours / 24);
  return `${days} d ago`;
};

/** "Sep 5, 10:16 PM" in the viewer's locale. */
export const formatClock = (iso: string | number | null | undefined): string => {
  if (iso == null) return '—';
  const d: Date = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/**
 * "7:28 PM" when the time falls on the anchor's calendar day (today by default, or the
 * run's start day for a step time), "Sep 5, 7:28 PM" otherwise; the caller puts the ISO
 * string in `title`.
 */
export const formatTime = (
  iso: string | null | undefined,
  now: number = Date.now(),
  anchor: string | number | null | undefined = now,
): string => {
  if (!iso) return '—';
  const d: Date = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const anchorDate: Date = new Date(anchor ?? now);
  const day: Date = Number.isNaN(anchorDate.getTime()) ? new Date(now) : anchorDate;
  return sameDay(d, day)
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : formatClock(iso);
};

/** Both ends of a span, the day printed once: "1:28 AM → 1:45 AM" on one day, with the day on both when it crosses midnight. */
export interface FormattedSpan {
  start: string;
  end: string;
}

/**
 * A start → finish pair for an attempt row. The start follows `formatTime` (day only
 * when it is not the anchor's day); the finish repeats the day only when it differs from
 * the start's day, so a row never says `Sep 6` twice.
 */
export const formatSpan = (
  startIso: string | null | undefined,
  endIso: string | null | undefined,
  now: number = Date.now(),
  anchor: string | number | null | undefined = now,
): FormattedSpan => {
  const start: string = formatTime(startIso, now, anchor);
  if (!endIso) return { start, end: '—' };
  const end: Date = new Date(endIso);
  if (Number.isNaN(end.getTime())) return { start, end: endIso };
  const startDate: Date | null = startIso ? new Date(startIso) : null;
  const sameAsStart: boolean =
    startDate !== null && !Number.isNaN(startDate.getTime()) && sameDay(startDate, end);
  return {
    start,
    end: sameAsStart
      ? end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      : formatTime(endIso, now, anchor),
  };
};

/** "Sep 5" — for run picker labels. */
export const formatDay = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d: Date = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/** "56 s", "2 min 10 s", "1 h 4 min" — durations for humans. */
export const formatDurationMs = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s: number = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m: number = Math.floor(s / 60);
  if (m < 60) return s % 60 === 0 ? `${m} min` : `${m} min ${s % 60} s`;
  const h: number = Math.floor(m / 60);
  return m % 60 === 0 ? `${h} h` : `${h} h ${m % 60} min`;
};

export const formatDuration = (
  startIso: string | null | undefined,
  endIso: string | null | undefined,
): string => {
  if (!startIso || !endIso) return '—';
  const ms: number = new Date(endIso).getTime() - new Date(startIso).getTime();
  return Number.isNaN(ms) ? '—' : formatDurationMs(ms);
};

/** "+0:00", "+5:21", "+1:18:00" — offset of a log line from the run start. */
export const formatOffset = (
  startIso: string | null | undefined,
  atIso: string | null | undefined,
): string => {
  if (!startIso || !atIso) return '';
  const ms: number = new Date(atIso).getTime() - new Date(startIso).getTime();
  if (Number.isNaN(ms)) return '';
  const total: number = Math.max(0, Math.round(ms / 1000));
  const h: number = Math.floor(total / 3600);
  const m: number = Math.floor((total % 3600) / 60);
  const s: number = total % 60;
  const mm: string = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `+${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
};

/** Working time over a loop: "1 h 19 min" for one attempt, "1 h 19 min ×4" for four. */
export const formatAttemptTotal = (totalMs: number, count: number): string =>
  count > 1 ? `${formatDurationMs(totalMs)} ×${count}` : formatDurationMs(totalMs);

/** "1.2 kB", "340 B", "3.5 MB" — file sizes in a directory listing. */
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(bytes < 10_000 ? 1 : 0)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
};

export interface FormattedParam {
  text: string;
  /** True when the value is absent (null/undefined) — rendered muted. */
  empty: boolean;
  /** True for objects and arrays — rendered as code. */
  code: boolean;
}

/** null/undefined → "—"; objects/arrays → JSON; everything else → its string. */
export const formatParam = (value: unknown): FormattedParam => {
  if (value === null || value === undefined) return { text: '—', empty: true, code: false };
  if (typeof value === 'object') return { text: JSON.stringify(value), empty: false, code: true };
  return { text: String(value), empty: false, code: false };
};

/** "1 of 3" when done; "attempt 2 of 3 running" while a step is in flight. */
export const formatAttempts = (
  attempts: number,
  max: number | undefined,
  running: boolean,
): string => {
  if (running) return max != null ? `attempt ${attempts + 1} of ${max}` : `attempt ${attempts + 1}`;
  return max != null ? `${attempts} of ${max}` : String(attempts);
};

/** True for values that read as a filesystem path or URL — rendered in mono and broken after `/`. */
export const looksLikePath = (text: string): boolean =>
  /^(\/|~\/|\.{1,2}\/|[a-z]+:\/\/)/i.test(text) || (text.includes('/') && !text.includes(' '));

/** "$41.23", "$0.09", "<$0.01" ("$0.00" for exactly zero) — cost.json is priced in USD. */
export const formatUSD = (n: number): string => {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n === 0) return '$0.00';
  if (n < 0.005) return '<$0.01';
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/** "812", "12.3k", "1.5M", "55.0M" — token counts (same shape as formatBytes). */
export const formatTokens = (n: number): string => {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
};

/** "45%" / "<1%" — a step's share of the run total. */
export const formatShare = (fraction: number): string => {
  if (!Number.isFinite(fraction) || fraction < 0) return '—';
  const pct: number = fraction * 100;
  return pct > 0 && pct < 1 ? '<1%' : `${Math.round(pct)}%`;
};
