import { useCallback, useEffect, useRef, useState } from 'react';
import { reconnectDelay } from './websocket.utils';

export type SocketState = 'connecting' | 'open' | 'closed';

export interface UseWebSocketOptions<In, Out> {
  /** `null` keeps the socket shut. */
  url: string | null;
  /** Raw text frame to a message, or `null` to drop the frame. */
  parse: (raw: string) => In | null;
  serialize: (message: Out) => string;
  onMessage: (message: In) => void;
  /**
   * Close and reconnect when no frame at all arrives for this long. The server sends a
   * `live.tick` every 15 s, so silence means the path is dead even though the socket says open.
   */
  staleMs?: number;
}

export interface WebSocketHandle<Out> {
  state: SocketState;
  /** `false` when the socket is not open and nothing was sent. */
  send: (message: Out) => boolean;
}

export const DEFAULT_STALE_MS = 45_000;

/**
 * A reconnecting WebSocket: backs off between attempts, waits while the page is hidden and
 * reconnects at once when it is shown again. A socket that goes silent for `staleMs` is closed
 * and reopened, so "open" on the page means frames can actually arrive. Callbacks may change
 * between renders without reopening the socket; only `url` does.
 */
export const useWebSocket = <In, Out>(
  options: UseWebSocketOptions<In, Out>,
): WebSocketHandle<Out> => {
  const [state, setState] = useState<SocketState>('closed');
  const socket = useRef<WebSocket | null>(null);
  const latest = useRef<UseWebSocketOptions<In, Out>>(options);
  latest.current = options;
  const { url } = options;
  const staleMs: number = options.staleMs ?? DEFAULT_STALE_MS;

  useEffect((): (() => void) | void => {
    if (url === null) return;
    let disposed = false;
    let attempt = 0;
    let timer: number | undefined;
    let staleTimer: number | undefined;

    /** Every frame (and the open) pushes the deadline back; silence past it closes the socket. */
    const heard = (ws: WebSocket): void => {
      window.clearTimeout(staleTimer);
      staleTimer = window.setTimeout((): void => {
        if (socket.current === ws) ws.close();
      }, staleMs);
    };

    const connect = (): void => {
      window.clearTimeout(timer);
      if (disposed) return;
      setState('connecting');
      const ws: WebSocket = new WebSocket(url);
      socket.current = ws;
      ws.onopen = (): void => {
        attempt = 0;
        setState('open');
        heard(ws);
      };
      ws.onmessage = (event: MessageEvent): void => {
        heard(ws);
        if (typeof event.data !== 'string') return;
        const message: In | null = latest.current.parse(event.data);
        if (message !== null) latest.current.onMessage(message);
      };
      ws.onclose = (): void => {
        window.clearTimeout(staleTimer);
        if (disposed || socket.current !== ws) return;
        socket.current = null;
        setState('closed');
        timer = window.setTimeout(retry, reconnectDelay(attempt));
        attempt += 1;
      };
      // `close` always follows `error`; the retry is scheduled there.
      ws.onerror = (): void => ws.close();
    };

    const retry = (): void => {
      // Hidden pages do not reconnect; `visibilitychange` does it on return.
      if (document.hidden) return;
      connect();
    };

    const onVisibility = (): void => {
      if (document.hidden || socket.current !== null) return;
      attempt = 0;
      connect();
    };

    connect();
    document.addEventListener('visibilitychange', onVisibility);
    return (): void => {
      disposed = true;
      window.clearTimeout(timer);
      window.clearTimeout(staleTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      const ws: WebSocket | null = socket.current;
      socket.current = null;
      ws?.close();
      setState('closed');
    };
  }, [url, staleMs]);

  const send = useCallback((message: Out): boolean => {
    const ws: WebSocket | null = socket.current;
    if (ws === null || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(latest.current.serialize(message));
    return true;
  }, []);

  return { state, send };
};
