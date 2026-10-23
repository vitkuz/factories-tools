import type { Server } from 'node:http';
import type { AppLogger } from '../types.js';

export interface AttachWebSocketSettings {
  server: Server;
  /** The one path upgrades are accepted on; any other upgrade is refused. */
  path: string;
  /** `undefined`: open on loopback. Otherwise `?key=` or the `x-api-key` header must match. */
  apiKey?: string;
  logger?: AppLogger;
  /** What a client is sent the moment it connects (the `hello` frame). */
  onConnect: () => unknown;
  /** One text frame from a client; the return value, if any, is sent back to that client. */
  onMessage: (raw: string, client: WsClient) => Promise<unknown>;
  /** A client went away (closed, or terminated by the heartbeat). */
  onDisconnect?: (client: WsClient) => void;
  heartbeatMs?: number;
}

/** One connected client, as handlers see it: an id to key subscriptions by, and a way to reach it. */
export interface WsClient {
  id: string;
  /** Dropped silently when the socket is no longer open. */
  send: (message: unknown) => void;
}

export interface WsHub {
  broadcast: (message: unknown) => void;
  clientCount: () => number;
  /** Closes every client and stops the heartbeat. */
  close: () => Promise<void>;
}
