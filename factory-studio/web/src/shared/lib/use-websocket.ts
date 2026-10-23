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
}

export interface WebSocketHandle<Out> {
  state: SocketState;
  /** `false` when the socket is not open and nothing was sent. */
  send: (message: Out) => boolean;
}

/**
 * A reconnecting WebSocket: backs off between attempts, waits while the page is hidden and
 * reconnects at once when it is shown again. Callbacks may change between renders without
 * reopening the socket; only `url` does.
 */
export const useWebSocket = <In, Out>(
  options: UseWebSocketOptions<In, Out>,
): WebSocketHandle<Out> => {
  const [state, setState] = useState<SocketState>('closed');
  const socket = useRef<WebSocket | null>(null);
  const latest = useRef<UseWebSocketOptions<In, Out>>(options);
  latest.current = options;
  const { url } = options;

  useEffect((): (() => void) | void => {
    if (url === null) return;
    let disposed = false;
    let attempt = 0;
    let timer: number | undefined;

    const connect = (): void => {
      window.clearTimeout(timer);
      if (disposed) return;
      setState('connecting');
      const ws: WebSocket = new WebSocket(url);
      socket.current = ws;
      ws.onopen = (): void => {
        attempt = 0;
        setState('open');
      };
      ws.onmessage = (event: MessageEvent): void => {
        if (typeof event.data !== 'string') return;
        const message: In | null = latest.current.parse(event.data);
        if (message !== null) latest.current.onMessage(message);
      };
      ws.onclose = (): void => {
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
      document.removeEventListener('visibilitychange', onVisibility);
      const ws: WebSocket | null = socket.current;
      socket.current = null;
      ws?.close();
      setState('closed');
    };
  }, [url]);

  const send = useCallback((message: Out): boolean => {
    const ws: WebSocket | null = socket.current;
    if (ws === null || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(latest.current.serialize(message));
    return true;
  }, []);

  return { state, send };
};
