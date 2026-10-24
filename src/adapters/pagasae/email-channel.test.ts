import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PersonShip } from '../../core/people/ports.js';
import { err, ok } from '../../core/shared/result.js';
import { createEmailChannel } from './email-channel.js';

const SHIP: PersonShip = { fleetId: 'flt_01m3tb1zgr5h2ffee12xnch8sv', shipId: 'shp_01m3tb1zgr5h2ffee12xnch8pp' };
const INSTALLATION_TOKEN = 'i'.repeat(64);
const WINDOW_MS = 3_600_000;

let server: Server;
let base: string;
let received: { method: string | undefined; url: string | undefined; headers: IncomingHttpHeaders; body: unknown }[];
let answer: { status: number; body: string };

async function jsonOf(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

beforeEach(async () => {
  received = [];
  answer = { status: 204, body: '' };
  server = createServer((request, response) => {
    void jsonOf(request).then((body) => {
      received.push({ method: request.method, url: request.url, headers: request.headers, body });
      response.writeHead(answer.status, { 'content-type': 'application/json' }).end(answer.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function channel(options: { url?: string; isOn?: boolean } = {}) {
  return createEmailChannel({
    url: options.url ?? base,
    installationToken: INSTALLATION_TOKEN,
    timeoutMs: 1000,
    windowMs: WINDOW_MS,
    emailChannels: { isOn: () => Promise.resolve(options.isOn ?? true), turn: () => Promise.resolve() },
  });
}

describe('the email channel, through pagasae (wake a person, W2)', () => {
  it("asks pagasae to wake the person ship's account, naming the ship, with the gateway's installation token", async () => {
    const woken = await channel().wake(SHIP);

    expect(woken).toEqual(ok(undefined));
    expect(received.map(({ method, url, headers, body }) => ({ method, url, authorization: headers.authorization, body }))).toEqual([
      { method: 'POST', url: '/api/wakes', authorization: `Bearer ${INSTALLATION_TOKEN}`, body: { fleetId: SHIP.fleetId, shipId: SHIP.shipId } },
    ]);
  });

  it('says the wake did not go out when pagasae refuses it', async () => {
    answer = { status: 404, body: '{"error":"unknown_person_ship"}' };

    await expect(channel().wake(SHIP)).resolves.toEqual(err({ reason: 'pagasae answered 404: unknown_person_ship' }));
  });

  it('says the wake did not go out when pagasae could not mail', async () => {
    answer = { status: 503, body: '{"error":"not_mailed"}' };

    await expect(channel().wake(SHIP)).resolves.toEqual(err({ reason: 'pagasae answered 503: not_mailed' }));
  });

  it('says the wake did not go out when pagasae does not answer', async () => {
    await expect(channel({ url: 'http://127.0.0.1:9' }).wake(SHIP)).resolves.toEqual(err({ reason: 'pagasae did not answer' }));
  });

  it('is on where the person turned email on, with its window from the configuration', async () => {
    const off = channel({ isOn: false });

    expect({ name: off.name, windowMs: off.windowMs, isOn: await off.isOn(SHIP) }).toEqual({ name: 'email', windowMs: WINDOW_MS, isOn: false });
  });
});
