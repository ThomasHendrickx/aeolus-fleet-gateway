import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFleetNetwork } from './fleet-network.js';

// The gateway reads whether the fleet applies network rules as the actor who
// turns outside parties on (decision 0057), with fleet.networkRules (core
// 0.28, aeolus-fleet #997): a ship by its crew token over REST, argo by the
// console session over tRPC.

let server: Server;
let base: string;
let received: { url: string | undefined; headers: IncomingHttpHeaders }[];
let answer: { status: number; body: unknown };

beforeEach(async () => {
  received = [];
  server = createServer((request, response) => {
    received.push({ url: request.url, headers: request.headers });
    response.writeHead(answer.status, { 'content-type': 'application/json' }).end(JSON.stringify(answer.body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const RULES = { applied: { rules: [{ verb: 'send', from: ['lbv_01m3tb1zgr5h2ffee12xnch8aa'], to: ['lbv_01m3tb1zgr5h2ffee12xnch8bb'] }], version: 3 }, draft: null };
const OPEN = { applied: { rules: null, version: 0 }, draft: null };

describe("the fleet's network, read as the actor", () => {
  it('is open while no rules are applied, read by a ship with its crew token', async () => {
    answer = { status: 200, body: OPEN };

    await expect(createFleetNetwork(base).isOpen({ crewToken: 'aeolus_ct_v1_networker' })).resolves.toEqual({ isOk: true, value: true });
    expect(received.map(({ url, headers }) => ({ url, authorization: headers.authorization }))).toEqual([{ url: '/api/v1/fleet/networkRules', authorization: 'Bearer aeolus_ct_v1_networker' }]);
  });

  it('is not open with rules applied, read by argo with the console session', async () => {
    answer = { status: 200, body: { result: { data: RULES } } };

    await expect(createFleetNetwork(base).isOpen({ cookie: 'aeolus_session=argo' })).resolves.toEqual({ isOk: true, value: false });
    expect(received.map(({ url, headers }) => ({ url, cookie: headers.cookie }))).toEqual([{ url: '/trpc/fleet.networkRules', cookie: 'aeolus_session=argo' }]);
  });

  it("answers the fleet's refusal", async () => {
    answer = { status: 403, body: { code: 'FORBIDDEN', message: 'This call needs the fleet:network scope' } };

    await expect(createFleetNetwork(base).isOpen({ crewToken: 'aeolus_ct_v1_reader' })).resolves.toEqual({ isOk: false, error: { code: 'FORBIDDEN', message: 'This call needs the fleet:network scope' } });
  });
});
