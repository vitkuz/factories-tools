/** The wait before reconnect attempt `attempt` (0-based): doubles from `baseMs`, capped at `maxMs`. */
export const reconnectDelay = (attempt: number, baseMs = 1000, maxMs = 15_000): number =>
  Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));

/** `ws://` or `wss://` for a page served over `http:` or `https:`. */
export const socketUrlFor = (location: { protocol: string; host: string }, path: string): string =>
  `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${path}`;
