import type { WsHub } from './ws.types.js';

export interface BroadcastBus {
  /** Safe to call before a hub is bound: the message is dropped, nobody is connected yet. */
  broadcast: (message: unknown) => void;
  bind: (hub: WsHub) => void;
}

/**
 * The usecases need `broadcast` before the http server exists, and the WebSocket hub needs the
 * server. The bus is the seam: usecases are handed `bus.broadcast`, the hub is bound later.
 */
export const createBroadcastBus = (): BroadcastBus => {
  let bound: WsHub | undefined;
  return {
    broadcast: (message: unknown): void => bound?.broadcast(message),
    bind: (hub: WsHub): void => {
      bound = hub;
    },
  };
};
