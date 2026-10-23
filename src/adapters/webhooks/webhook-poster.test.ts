import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createWebhookPoster } from './webhook-poster.js';

// The poster connects only to an address the policy allows, as the name
// resolved at the moment it connects: a name resolving inside is refused
// even when it resolved outside a moment before. The tests reach a local
// server, which the gateway's own policy refuses, by a policy that allows it.

let server: Server;
let port: number;
let received: { headers: IncomingHttpHeaders; body: string }[];
let status: number;

beforeEach(async () => {
  received = [];
  status = 204;
  server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    request.on('end', () => {
      received.push({ headers: request.headers, body });
      response.writeHead(status).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  ({ port } = z.object({ port: z.number() }).parse(server.address()));
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/** A name that resolves to the local server. */
const lookupTo = (address: string) => () => Promise.resolve([address]);
const allowingLocal = (address: string) => address === '127.0.0.1';

describe('the webhook poster (slice 4)', () => {
  it('POSTs the body as JSON with the token and the authentication, and answers the status', async () => {
    const poster = createWebhookPoster({ addressesOf: lookupTo('127.0.0.1'), isAllowedAddress: allowingLocal, timeoutMs: 2_000 });

    const posted = await poster.post(`http://hooks.supplier.test:${String(port)}/a2a`, { body: '{"statusUpdate":{}}', token: 'tok-1', authentication: { scheme: 'Bearer', credentials: 'secret-1' } });

    expect(posted).toEqual({ isOk: true, value: { status: 204 } });
    expect(received).toMatchObject([{ body: '{"statusUpdate":{}}', headers: { 'content-type': 'application/json', 'x-a2a-notification-token': 'tok-1', authorization: 'Bearer secret-1' } }]);
  });

  it('sends no token or authorization header when the config has none', async () => {
    const poster = createWebhookPoster({ addressesOf: lookupTo('127.0.0.1'), isAllowedAddress: allowingLocal, timeoutMs: 2_000 });

    await poster.post(`http://hooks.supplier.test:${String(port)}/a2a`, { body: '{}', token: null, authentication: null });

    expect(received[0]?.headers).not.toHaveProperty('x-a2a-notification-token');
    expect(received[0]?.headers).not.toHaveProperty('authorization');
  });

  it('refuses to connect when the name resolves to an address the policy refuses, sending nothing', async () => {
    const poster = createWebhookPoster({ addressesOf: lookupTo('127.0.0.1'), isAllowedAddress: () => false, timeoutMs: 2_000 });

    const posted = await poster.post(`http://hooks.supplier.test:${String(port)}/a2a`, { body: '{}', token: null, authentication: null });

    expect({ posted, received }).toEqual({ posted: { isOk: false, error: { kind: 'ADDRESS_REFUSED' } }, received: [] });
  });

  it('answers unreachable when nothing answers', async () => {
    const poster = createWebhookPoster({ addressesOf: lookupTo('127.0.0.1'), isAllowedAddress: allowingLocal, timeoutMs: 2_000 });
    await new Promise((resolve) => server.close(resolve));

    await expect(poster.post(`http://hooks.supplier.test:${String(port)}/a2a`, { body: '{}', token: null, authentication: null })).resolves.toMatchObject({ isOk: false, error: { kind: 'UNREACHABLE' } });
    server = createServer();
  });

  it('answers the status a webhook refused with', async () => {
    status = 404;
    const poster = createWebhookPoster({ addressesOf: lookupTo('127.0.0.1'), isAllowedAddress: allowingLocal, timeoutMs: 2_000 });

    await expect(poster.post(`http://hooks.supplier.test:${String(port)}/a2a`, { body: '{}', token: null, authentication: null })).resolves.toEqual({ isOk: true, value: { status: 404 } });
  });

  it('answers unreachable when the whole answer does not come within the timeout, however steadily it trickles', async () => {
    const trickling = createServer((_request, response) => {
      response.writeHead(200);
      const drip = setInterval(() => response.write('.'), 20);
      response.on('close', () => {
        clearInterval(drip);
      });
    });
    await new Promise<void>((resolve) => trickling.listen(0, '127.0.0.1', resolve));
    const { port: tricklingPort } = z.object({ port: z.number() }).parse(trickling.address());
    const poster = createWebhookPoster({ addressesOf: lookupTo('127.0.0.1'), isAllowedAddress: allowingLocal, timeoutMs: 300 });

    const posted = await poster.post(`http://hooks.supplier.test:${String(tricklingPort)}/a2a`, { body: '{}', token: null, authentication: null });

    trickling.closeAllConnections();
    await new Promise((resolve) => trickling.close(resolve));
    expect(posted).toEqual({ isOk: false, error: { kind: 'UNREACHABLE', message: 'No answer within 300 ms' } });
  });

  it('answers the status without reading an answer body past its cap', async () => {
    const flooding = createServer((_request, response) => {
      response.writeHead(200);
      const chunk = Buffer.alloc(16_384, 'x');
      const flood = () => {
        while (response.write(chunk)) {
          // Writes until the socket pushes back, then again once it drained.
        }
      };
      response.on('drain', flood);
      flood();
    });
    await new Promise<void>((resolve) => flooding.listen(0, '127.0.0.1', resolve));
    const { port: floodingPort } = z.object({ port: z.number() }).parse(flooding.address());
    const poster = createWebhookPoster({ addressesOf: lookupTo('127.0.0.1'), isAllowedAddress: allowingLocal, timeoutMs: 5_000 });

    const posted = await poster.post(`http://hooks.supplier.test:${String(floodingPort)}/a2a`, { body: '{}', token: null, authentication: null });

    flooding.closeAllConnections();
    await new Promise((resolve) => flooding.close(resolve));
    expect(posted).toEqual({ isOk: true, value: { status: 200 } });
  });
});
