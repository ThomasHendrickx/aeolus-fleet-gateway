import { createServer, type Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFleetShips } from './fleet-ships.js';

// The fleet answers fleet.list a page at a time (performance S6): the gateway
// reads on from each page's nextCursor until it is null, so it sees every ship.

const FIRST = 'shp_01m3tbfspe96yf1rnr4ank9crm';
const SECOND = 'shp_01m3tbfspe96yf1rnr4ank9crn';
const THIRD = 'shp_01m3tbfspe96yf1rnr4ank9crp';

function aListedShip(id: string, name: string) {
  return {
    id,
    name,
    type: 'claude-code',
    kind: 'agent',
    status: 'crewed',
    startingPrompt: null,
    location: null,
    lastSeenAt: null,
    ping: null,
    harness: null,
    model: null,
    scopes: [],
    report: null,
    crewRequest: null,
    labels: [],
    awaitingCrewSince: null,
    retiredAt: null,
    ownerShipId: null,
    openAlertCount: 0,
    activity: null,
  };
}

let server: Server;
let base: string;
let asked: unknown[];
let pages: Map<string | undefined, { status: number; body: unknown }>;

beforeEach(async () => {
  asked = [];
  server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', () => {
      const input: unknown = JSON.parse(body);
      asked.push(input);
      const cursor = typeof input === 'object' && input !== null && 'cursor' in input && typeof input.cursor === 'string' ? input.cursor : undefined;
      const page = pages.get(cursor) ?? { status: 500, body: null };
      response.writeHead(page.status, { 'content-type': 'application/json' }).end(JSON.stringify(page.body));
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

describe("the fleet's ships, read as the actor", () => {
  it('reads on from each page until the fleet answers no next cursor, so every ship is listed', async () => {
    pages = new Map([
      [undefined, { status: 200, body: { items: [aListedShip(FIRST, 'scout')], nextCursor: FIRST } }],
      [FIRST, { status: 200, body: { items: [aListedShip(SECOND, 'builder'), { id: THIRD, name: 'hidden', type: 'claude-code', status: 'crewed', isInReadReach: false }], nextCursor: THIRD } }],
      [THIRD, { status: 200, body: { items: [], nextCursor: null } }],
    ]);

    await expect(createFleetShips(base).list({ crewToken: 'aeolus_ct_v1_gateway' })).resolves.toEqual({
      isOk: true,
      value: [
        { shipId: FIRST, name: 'scout', kind: 'agent', status: 'crewed' },
        { shipId: SECOND, name: 'builder', kind: 'agent', status: 'crewed' },
      ],
    });
    expect(asked).toEqual([{ limit: 500 }, { cursor: FIRST, limit: 500 }, { cursor: THIRD, limit: 500 }]);
  });

  it('answers the refusal of a later page, not the ships read before it', async () => {
    pages = new Map([
      [undefined, { status: 200, body: { items: [aListedShip(FIRST, 'scout')], nextCursor: FIRST } }],
      [FIRST, { status: 403, body: { code: 'FORBIDDEN', message: 'Not in reach' } }],
    ]);

    await expect(createFleetShips(base).list({ crewToken: 'aeolus_ct_v1_gateway' })).resolves.toEqual({ isOk: false, error: { code: 'FORBIDDEN', message: 'Not in reach' } });
  });

  it('answers the fleet unavailable when a page is not a page of ships', async () => {
    pages = new Map([[undefined, { status: 200, body: [aListedShip(FIRST, 'scout')] }]]);

    await expect(createFleetShips(base).list({ crewToken: 'aeolus_ct_v1_gateway' })).resolves.toEqual({ isOk: false, error: { code: 'UNAVAILABLE', message: 'The fleet answered no ships' } });
  });
});
