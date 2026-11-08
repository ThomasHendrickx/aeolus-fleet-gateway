import { createServer, type Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFleetRetention } from './fleet-retention.js';

// The retention is read from core's fleet.limits as the account; nothing else
// of its answer is kept.

let server: Server;
let base: string;
let asked: unknown[];
let reply: { status: number; body: unknown };

beforeEach(async () => {
  asked = [];
  server = createServer((request, response) => {
    asked.push({ path: new URL(request.url ?? '', 'http://x').pathname, authorization: request.headers.authorization });
    response.writeHead(reply.status, { 'content-type': 'application/json' }).end(JSON.stringify(reply.body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const AS_ACCOUNT = { crewToken: 'aeolus_ct_v1_gateway', accountToken: 'aeolus_at_v1_thomas' };

function limits(retention: unknown) {
  return {
    status: 200,
    body: { result: { data: { ships: { limit: null, count: 3 }, dailyMessages: { limit: null, count: 9, resetsAt: '2026-11-09T00:00:00.000Z' }, retention } } },
  };
}

describe("the fleet's retention, read as the account", () => {
  it("reads fleet.limits as the gateway's ship presenting the account", async () => {
    reply = limits({ days: null, keptFrom: null });

    await createFleetRetention(base).retention(AS_ACCOUNT);

    expect(asked).toEqual([{ path: '/trpc/fleet.limits', authorization: 'Bearer aeolus_ct_v1_gateway' }]);
  });

  it('answers the days and keptFrom as core worded them', async () => {
    reply = limits({ days: 90, keptFrom: '2026-08-10T00:00:00.000Z' });

    await expect(createFleetRetention(base).retention(AS_ACCOUNT)).resolves.toEqual({ isOk: true, value: { days: 90, keptFrom: '2026-08-10T00:00:00.000Z' } });
  });

  it('answers null days and null keptFrom for a fleet with no retention', async () => {
    reply = limits({ days: null, keptFrom: null });

    await expect(createFleetRetention(base).retention(AS_ACCOUNT)).resolves.toEqual({ isOk: true, value: { days: null, keptFrom: null } });
  });

  it("passes on the fleet's refusal", async () => {
    reply = { status: 403, body: { error: { message: 'fleet.limits needs the fleet:read scope', data: { code: 'FORBIDDEN' } } } };

    await expect(createFleetRetention(base).retention(AS_ACCOUNT)).resolves.toEqual({ isOk: false, error: { code: 'FORBIDDEN', message: 'fleet.limits needs the fleet:read scope' } });
  });

  it('says unavailable when the fleet answers no retention', async () => {
    reply = { status: 200, body: { result: { data: { ships: null } } } };

    await expect(createFleetRetention(base).retention(AS_ACCOUNT)).resolves.toEqual({ isOk: false, error: { code: 'UNAVAILABLE', message: 'The fleet answered no retention' } });
  });
});
