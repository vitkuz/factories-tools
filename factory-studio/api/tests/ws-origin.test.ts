import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { attachWebSocket, originMatchesHost, type WsHub } from '../src/shared/ws/index.js';
import { quiet } from './work-dir.js';

describe('originMatchesHost', () => {
  it.each([
    [undefined, '127.0.0.1:3110', true],
    ['http://127.0.0.1:3110', '127.0.0.1:3110', true],
    ['http://localhost:5175', 'localhost:5175', true],
    ['http://LOCALHOST:5175', 'localhost:5175', true],
    // Behind Caddy: the browser's https origin, the Host header Caddy forwards unchanged.
    ['https://98-87-219-47.sslip.io', '98-87-219-47.sslip.io', true],
    ['https://98-87-219-47.sslip.io', '98-87-219-47.sslip.io:443', true],
    ['http://example.com', 'example.com:80', true],
    ['null', '127.0.0.1:3110', false],
    ['https://evil.example', '127.0.0.1:3110', false],
    ['http://127.0.0.1:3111', '127.0.0.1:3110', false],
    ['https://98-87-219-47.sslip.io:8443', '98-87-219-47.sslip.io', false],
    ['https://98-87-219-47.sslip.io.evil.example', '98-87-219-47.sslip.io', false],
    ['file:///tmp/x.html', '127.0.0.1:3110', false],
    ['http://127.0.0.1:3110', undefined, false],
    ['http://127.0.0.1:3110', '', false],
    ['http://127.0.0.1:3110', '127.0.0.1:3110/x', false],
    ['not a url', '127.0.0.1:3110', false],
  ])('origin %s, host %s -> %s', (origin, host, expected) => {
    expect(originMatchesHost(origin, host)).toBe(expected);
  });
});

describe('WS upgrade origin check', () => {
  let server: Server;
  let hub: WsHub;
  let url: string;
  let origin: string;

  beforeAll(async () => {
    server = createServer();
    hub = attachWebSocket({
      server,
      path: '/api/v1/ws',
      logger: quiet,
      onConnect: (): unknown => ({ type: 'hello', pending: [] }),
      onMessage: async (): Promise<unknown> => null,
    });
    await new Promise<void>((resolve): void => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const port: number = (server.address() as AddressInfo).port;
    url = `ws://127.0.0.1:${port}/api/v1/ws`;
    origin = `http://127.0.0.1:${port}`;
  });
  afterAll(async () => {
    await hub.close();
    server.closeAllConnections();
    await new Promise<void>((resolve): void => {
      server.close((): void => resolve());
    });
  });

  /** The first frame's type, or `status <n>` when the upgrade is refused. */
  const open = (headers: Record<string, string>): Promise<string> =>
    new Promise<string>((resolve, reject): void => {
      const ws: WebSocket = new WebSocket(url, { headers });
      ws.once('message', (data: WebSocket.RawData): void => {
        resolve((JSON.parse(String(data)) as { type: string }).type);
        ws.close();
      });
      ws.once('unexpected-response', (_req: unknown, res: IncomingMessage): void =>
        resolve(`status ${res.statusCode}`),
      );
      ws.once('error', reject);
    });

  it('opens without an Origin header (curl, hooks, the ws client)', async () => {
    expect(await open({})).toBe('hello');
  });

  it('opens from this origin', async () => {
    expect(await open({ origin })).toBe('hello');
  });

  it('refuses a sandboxed page (Origin: null) and any other site', async () => {
    expect(await open({ origin: 'null' })).toBe('status 403');
    expect(await open({ origin: 'https://evil.example' })).toBe('status 403');
  });
});
