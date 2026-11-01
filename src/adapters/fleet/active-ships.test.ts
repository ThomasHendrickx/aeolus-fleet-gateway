import { createServer, type Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createActiveShips } from './active-ships.js';

// Your fleet reads the fleet's active ships as the account (fleet.list): retired
// ships are filtered out in the fleet's own query, and every page is read.

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

describe("the fleet's active ships, read as the account", () => {
  const AS_ACCOUNT = { crewToken: 'aeolus_ct_v1_gateway', accountToken: 'aeolus_at_v1_thomas' };

  it('asks only for ships awaiting crew or crewed, reading on from each page until no next cursor', async () => {
    pages = new Map([
      [undefined, { status: 200, body: { items: [aListedShip(FIRST, 'scout')], nextCursor: FIRST } }],
      [FIRST, { status: 200, body: { items: [], nextCursor: null } }],
    ]);

    await createActiveShips(base).list(AS_ACCOUNT);

    expect(asked).toEqual([
      { status: ['awaitingCrew', 'crewed'], limit: 500 },
      { status: ['awaitingCrew', 'crewed'], cursor: FIRST, limit: 500 },
    ]);
  });

  it("answers each ship with its kind, status, crew's report and open alerts, leaving out ships outside the read reach", async () => {
    pages = new Map([
      [
        undefined,
        {
          status: 200,
          body: {
            items: [
              { ...aListedShip(FIRST, 'reviewer'), report: { state: 'working', note: 'reviewing #165', task: null, step: null, reportedAt: '2026-11-01T12:00:00.000Z', reportChangedAt: '2026-11-01T12:00:00.000Z', detailsVersion: 0 }, openAlertCount: 2 },
              { ...aListedShip(SECOND, 'github'), kind: 'app', status: 'awaitingCrew' },
              { id: THIRD, name: 'hidden', type: 'claude-code', status: 'crewed', isInReadReach: false },
            ],
            nextCursor: null,
          },
        },
      ],
    ]);

    await expect(createActiveShips(base).list(AS_ACCOUNT)).resolves.toEqual({
      isOk: true,
      value: [
        { shipId: FIRST, name: 'reviewer', kind: 'agent', status: 'crewed', report: { state: 'working', note: 'reviewing #165' }, openAlertCount: 2 },
        { shipId: SECOND, name: 'github', kind: 'app', status: 'awaitingCrew', report: null, openAlertCount: 0 },
      ],
    });
  });

  it("answers the fleet's refusal", async () => {
    pages = new Map([[undefined, { status: 403, body: { code: 'FORBIDDEN', message: 'fleet.list needs the fleet:read scope' } }]]);

    await expect(createActiveShips(base).list(AS_ACCOUNT)).resolves.toEqual({ isOk: false, error: { code: 'FORBIDDEN', message: 'fleet.list needs the fleet:read scope' } });
  });

  it('answers the fleet unavailable when a page is not a page of ships', async () => {
    pages = new Map([[undefined, { status: 200, body: [aListedShip(FIRST, 'scout')] }]]);

    await expect(createActiveShips(base).list(AS_ACCOUNT)).resolves.toEqual({ isOk: false, error: { code: 'UNAVAILABLE', message: 'The fleet answered no ships' } });
  });
});
