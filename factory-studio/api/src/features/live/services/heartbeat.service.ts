export interface HeartbeatSettings {
  /** Reaches every connected socket (the hub's broadcast). */
  broadcast: (message: unknown) => void;
  intervalMs?: number;
  now?: () => Date;
}

export interface Heartbeat {
  start: () => void;
  stop: () => void;
}

/**
 * A `live.tick` frame to every client every `intervalMs` (15 s). A browser cannot see the
 * WebSocket ping/pong the server already uses, so a socket whose path died (a laptop that
 * slept, a NAT that forgot it) would stay "open" on the page for as long as TCP takes to
 * notice, saying Live while nothing arrives. With a frame it can expect, the client closes and
 * reconnects when the ticks stop (see `useWebSocket`'s `staleMs`).
 */
export const createHeartbeat = ({
  broadcast,
  intervalMs = 15_000,
  now = (): Date => new Date(),
}: HeartbeatSettings): Heartbeat => {
  let timer: NodeJS.Timeout | undefined;
  return {
    start: (): void => {
      if (timer) return;
      timer = setInterval((): void => {
        broadcast({ type: 'live.tick', at: now().toISOString() });
      }, intervalMs);
      timer.unref();
    },
    stop: (): void => {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
};
