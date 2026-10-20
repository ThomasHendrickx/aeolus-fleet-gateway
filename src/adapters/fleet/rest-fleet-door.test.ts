import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRestFleetDoor } from './rest-fleet-door.js';

const PERSON_SHIP = 'shp_01m3tb1zgr5h2ffee12xnch8pp';

let server: Server;
let base: string;
let received: { url: string | undefined; headers: IncomingHttpHeaders; body: string }[];
let answer: { status: number; body: unknown };

beforeEach(async () => {
  received = [];
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received.push({ url: request.url, headers: request.headers, body: Buffer.concat(chunks).toString('utf8') });
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

const CALL = { crewToken: 'aeolus_ct_v1_gateway', accountToken: 'account-token-1', shipId: PERSON_SHIP } as const;

/** The parts of a received call that say who made it and what. */
function sent() {
  return received.map(({ url, headers, body }) => ({ url, authorization: headers.authorization, accountToken: headers['aeolus-account-token'], body: JSON.parse(body) as unknown }));
}

describe("the fleet's calls the gateway makes for a signed-in account (decision 0057)", () => {
  it("gets a ship's starting prompt with the account's token beside the gateway's crew token, answering its secret", async () => {
    answer = { status: 200, body: { shipId: PERSON_SHIP, prompt: 'p', crewLines: [], secret: 'aeolus_sk_v1_secret' } };

    await expect(createRestFleetDoor(base).startingPrompt(CALL)).resolves.toEqual({ isOk: true, value: { secret: 'aeolus_sk_v1_secret' } });
    expect(sent()).toEqual([{ url: '/api/v1/fleet/getStartingPrompt', authorization: 'Bearer aeolus_ct_v1_gateway', accountToken: 'account-token-1', body: { shipId: PERSON_SHIP } }]);
  });

  it('releases a ship with the account token beside the crew token', async () => {
    answer = { status: 200, body: {} };

    await expect(createRestFleetDoor(base).release(CALL)).resolves.toEqual({ isOk: true, value: undefined });
    expect(sent()).toEqual([{ url: '/api/v1/fleet/release', authorization: 'Bearer aeolus_ct_v1_gateway', accountToken: 'account-token-1', body: { shipId: PERSON_SHIP } }]);
  });

  it("answers the fleet's refusal", async () => {
    answer = { status: 409, body: { code: 'CONFLICT', message: 'person-charlotte is crewed' } };

    await expect(createRestFleetDoor(base).startingPrompt(CALL)).resolves.toEqual({ isOk: false, error: { code: 'CONFLICT', message: 'person-charlotte is crewed' } });
  });
});
