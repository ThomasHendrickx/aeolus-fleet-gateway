import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProxyShipsAsActor } from './proxy-ships-as-actor.js';

// The gateway retires a party's proxy ship as the actor who asked (decision
// 0057): a ship by its crew token over REST, an account by its account token
// presented by the gateway's ship over REST, argo by the console session over
// tRPC.

const PROXY = 'shp_01m3tbfspe96yf1rnr4ank9crm';

let server: Server;
let base: string;
let received: { url: string | undefined; headers: IncomingHttpHeaders; body: string }[];
let answer: { status: number; body: unknown };

beforeEach(async () => {
  received = [];
  server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', () => {
      received.push({ url: request.url, headers: request.headers, body });
      response.writeHead(answer.status, { 'content-type': 'application/json' }).end(JSON.stringify(answer.body));
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

describe("a party's proxy ship, retired as the actor", () => {
  it('is retired by a ship with its crew token over REST', async () => {
    answer = { status: 200, body: { abandonedDeliveries: 0 } };

    await expect(createProxyShipsAsActor(base).retire({ crewToken: 'aeolus_ct_v1_manager' }, { shipId: PROXY })).resolves.toEqual({ isOk: true, value: undefined });
    expect(received.map(({ url, headers, body }) => ({ url, authorization: headers.authorization, body }))).toEqual([
      { url: '/api/v1/fleet/retire', authorization: 'Bearer aeolus_ct_v1_manager', body: JSON.stringify({ shipId: PROXY }) },
    ]);
  });

  it("is retired by an account with its account token, presented by the gateway's ship", async () => {
    answer = { status: 200, body: { abandonedDeliveries: 0 } };

    await createProxyShipsAsActor(base).retire({ crewToken: 'aeolus_ct_v1_gateway', accountToken: 'account-token-1' }, { shipId: PROXY });

    expect(received.map(({ headers }) => ({ authorization: headers.authorization, account: headers['aeolus-account-token'] }))).toEqual([{ authorization: 'Bearer aeolus_ct_v1_gateway', account: 'account-token-1' }]);
  });

  it('is retired by argo with the console session over tRPC', async () => {
    answer = { status: 200, body: { result: { data: { abandonedDeliveries: 0 } } } };

    await expect(createProxyShipsAsActor(base).retire({ cookie: 'aeolus_session=argo' }, { shipId: PROXY })).resolves.toEqual({ isOk: true, value: undefined });
    expect(received.map(({ url, headers, body }) => ({ url, cookie: headers.cookie, body }))).toEqual([{ url: '/trpc/fleet.retire', cookie: 'aeolus_session=argo', body: JSON.stringify({ shipId: PROXY }) }]);
  });

  it("answers the fleet's refusal, by either door", async () => {
    answer = { status: 403, body: { code: 'FORBIDDEN', message: 'The network rules do not allow this manage' } };
    const rest = await createProxyShipsAsActor(base).retire({ crewToken: 'aeolus_ct_v1_manager' }, { shipId: PROXY });
    answer = { status: 409, body: { error: { message: 'crm is retired already', data: { code: 'CONFLICT' } } } };
    const trpc = await createProxyShipsAsActor(base).retire({ cookie: 'aeolus_session=argo' }, { shipId: PROXY });

    expect({ rest, trpc }).toEqual({
      rest: { isOk: false, error: { code: 'FORBIDDEN', message: 'The network rules do not allow this manage' } },
      trpc: { isOk: false, error: { code: 'CONFLICT', message: 'crm is retired already' } },
    });
  });

  it('answers UNAVAILABLE when the fleet does not answer', async () => {
    await expect(createProxyShipsAsActor('http://127.0.0.1:1').retire({ crewToken: 'aeolus_ct_v1_manager' }, { shipId: PROXY })).resolves.toMatchObject({ isOk: false, error: { code: 'UNAVAILABLE' } });
  });
});
