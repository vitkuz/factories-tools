import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { v4 as uuid } from 'uuid';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { API_KEY_HEADER, keysMatch } from '../middleware/api-key.js';
import type { AttachWebSocketSettings, WsClient, WsHub } from './ws.types.js';

const requestUrl = (req: IncomingMessage): URL => new URL(req.url ?? '/', 'http://localhost');

const presentedKey = (req: IncomingMessage): string | undefined => {
  const header: string | string[] | undefined = req.headers[API_KEY_HEADER];
  const fromHeader: string | undefined = Array.isArray(header) ? header[0] : header;
  return fromHeader || requestUrl(req).searchParams.get('key') || undefined;
};

export const isAuthorized = (req: IncomingMessage, apiKey: string | undefined): boolean => {
  if (apiKey === undefined) return true;
  const presented: string | undefined = presentedKey(req);
  return presented !== undefined && keysMatch(presented, apiKey);
};

const DEFAULT_PORTS: Readonly<Record<string, string>> = {
  'http:': '80',
  'https:': '443',
  'ws:': '80',
  'wss:': '443',
};

/** `host[:port]` of a `Host` header, the port filled from the origin's scheme when absent. */
const hostKey = (host: string, protocol: string): string | null => {
  try {
    const parsed: URL = new URL(`${protocol}//${host}`);
    if (parsed.host === '' || parsed.pathname !== '/' || parsed.username !== '') return null;
    return `${parsed.hostname}:${parsed.port || DEFAULT_PORTS[protocol] || ''}`;
  } catch {
    return null;
  }
};

/**
 * A browser names the page a socket is opened from; it must be this server, as the request's
 * `Host` names it (Caddy forwards `Host` unchanged, so `https://<domain>` matches `<domain>`;
 * the Vite dev proxy keeps it too). Hosts compare case-insensitively with default ports
 * filled in. No header — curl, the `ws` client, hooks — passes, as before. `Origin: null` (a
 * sandboxed page, a file) and any other site do not. Pure.
 */
export const originMatchesHost = (
  origin: string | undefined,
  host: string | undefined,
): boolean => {
  if (origin === undefined) return true;
  if (host === undefined || host === '') return false;
  try {
    const from: URL = new URL(origin);
    if (DEFAULT_PORTS[from.protocol] === undefined) return false;
    const own: string | null = hostKey(host, from.protocol);
    return own !== null && own === `${from.hostname}:${from.port || DEFAULT_PORTS[from.protocol]}`;
  } catch {
    return false;
  }
};

const refuse = (socket: Duplex, status: string): void => {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
};

const sendJson = (socket: WebSocket, message: unknown): void => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
};

const rawToText = (data: RawData): string =>
  Array.isArray(data)
    ? Buffer.concat(data).toString('utf8')
    : Buffer.from(data as Buffer).toString('utf8');

/**
 * A WebSocket endpoint on an existing http server, upgrade handling only (`noServer`), so the
 * Express app is untouched. Auth is the same key as the REST routes, and a browser must open
 * the socket from this origin (`originMatchesHost`). Dead peers are found by ping/pong and
 * terminated.
 */
export const attachWebSocket = ({
  server,
  path,
  apiKey,
  logger,
  onConnect,
  onMessage,
  onDisconnect,
  heartbeatMs = 30_000,
}: AttachWebSocketSettings): WsHub => {
  const wss: WebSocketServer = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  const alive: WeakSet<WebSocket> = new WeakSet();

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (requestUrl(req).pathname !== path) {
      refuse(socket, '404 Not Found');
      return;
    }
    if (!originMatchesHost(req.headers.origin, req.headers.host)) {
      logger?.warn('ws rejected: foreign origin', {
        ip: req.socket.remoteAddress,
        origin: req.headers.origin,
      });
      refuse(socket, '403 Forbidden');
      return;
    }
    if (!isAuthorized(req, apiKey)) {
      logger?.warn('ws rejected: bad or missing api key', { ip: req.socket.remoteAddress });
      refuse(socket, '401 Unauthorized');
      return;
    }
    wss.handleUpgrade(req, socket, head, (client: WebSocket): void => {
      wss.emit('connection', client, req);
    });
  });

  wss.on('connection', (client: WebSocket): void => {
    const handle: WsClient = {
      id: uuid(),
      send: (message: unknown): void => sendJson(client, message),
    };
    alive.add(client);
    client.on('close', (): void => onDisconnect?.(handle));
    client.on('pong', (): void => {
      alive.add(client);
    });
    client.on('message', (data: RawData): void => {
      onMessage(rawToText(data), handle)
        .then((reply: unknown): void => {
          if (reply !== null && reply !== undefined) sendJson(client, reply);
        })
        .catch((error: unknown): void => {
          logger?.error('ws handler failed', {
            message: error instanceof Error ? error.message : String(error),
          });
          sendJson(client, { type: 'error', message: 'internal error' });
        });
    });
    client.on('error', (error: Error): void => {
      logger?.warn('ws client error', { message: error.message });
    });
    sendJson(client, onConnect());
  });

  const heartbeat: NodeJS.Timeout = setInterval((): void => {
    for (const client of wss.clients) {
      if (!alive.has(client)) {
        client.terminate();
        continue;
      }
      alive.delete(client);
      client.ping();
    }
  }, heartbeatMs);
  heartbeat.unref();

  return {
    broadcast: (message: unknown): void => {
      for (const client of wss.clients) sendJson(client, message);
    },
    clientCount: (): number => wss.clients.size,
    close: (): Promise<void> =>
      new Promise<void>((resolve): void => {
        clearInterval(heartbeat);
        for (const client of wss.clients) client.close(1001, 'server shutting down');
        wss.close((): void => resolve());
      }),
  };
};
