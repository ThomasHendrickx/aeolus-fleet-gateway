import { createServer, type Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createActiveShips } from './active-ships.js';

// Your fleet reads the fleet's Harbour (fleet.harbour) as the account: core
// answers each active ship's tile, its state and when it last did something,
// and every page is read.

const FIRST = 'shp_01m3tbfspe96yf1rnr4ank9crm';
const SECOND = 'shp_01m3tbfspe96yf1rnr4ank9crn';

function aTile(id: string, name: string) {
  return { id, name, kind: 'agent', state: 'idle', note: null, lastActivityAt: null };
}

let server: Server;
let base: string;
let asked: unknown[];
let pages: Map<string | undefined, { status: number; body: unknown }>;

beforeEach(async () => {
  asked = [];
  server = createServer((request, response) => {
    const input: unknown = JSON.parse(new URL(request.url ?? '', 'http://x').searchParams.get('input') ?? 'null');
    asked.push({ path: new URL(request.url ?? '', 'http://x').pathname, input, authorization: request.headers.authorization });
    const cursor = typeof input === 'object' && input !== null && 'cursor' in input && typeof input.cursor === 'string' ? input.cursor : undefined;
    const page = pages.get(cursor) ?? { status: 500, body: null };
    response.writeHead(page.status, { 'content-type': 'application/json' }).end(JSON.stringify(page.body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function answer(data: unknown) {
  return { status: 200, body: { result: { data } } };
}

describe("the fleet's Harbour, read as the account", () => {
  const AS_ACCOUNT = { crewToken: 'aeolus_ct_v1_gateway', accountToken: 'aeolus_at_v1_thomas' };

  it('reads the Harbour page by page until no next cursor, as the gateway ship presenting the account', async () => {
    pages = new Map([
      [undefined, answer({ items: [aTile(FIRST, 'scout')], nextCursor: 'next-page', counts: null })],
      ['next-page', answer({ items: [], nextCursor: null, counts: null })],
    ]);

    await createActiveShips(base).list(AS_ACCOUNT);

    expect(asked).toEqual([
      { path: '/trpc/fleet.harbour', input: { limit: 500 }, authorization: 'Bearer aeolus_ct_v1_gateway' },
      { path: '/trpc/fleet.harbour', input: { cursor: 'next-page', limit: 500 }, authorization: 'Bearer aeolus_ct_v1_gateway' },
    ]);
  });

  it("answers each ship with its kind, state, note and when it last did something, as core worded them", async () => {
    pages = new Map([
      [
        undefined,
        answer({
          items: [
            { ...aTile(FIRST, 'reviewer'), state: 'working', note: 'reviewing #165', lastActivityAt: '2026-11-01T12:00:00.000Z' },
            { ...aTile(SECOND, 'github'), kind: 'app', state: 'idle' },
          ],
          nextCursor: null,
          counts: null,
        }),
      ],
    ]);

    await expect(createActiveShips(base).list(AS_ACCOUNT)).resolves.toEqual({
      isOk: true,
      value: [
        { shipId: FIRST, name: 'reviewer', kind: 'agent', state: 'working', note: 'reviewing #165', lastActivityAt: '2026-11-01T12:00:00.000Z' },
        { shipId: SECOND, name: 'github', kind: 'app', state: 'idle', note: null, lastActivityAt: null },
      ],
    });
  });

  it('answers awaiting crew and blocked ships in those states, two states as core words them (docs/design/state-colours)', async () => {
    pages = new Map([
      [
        undefined,
        answer({
          items: [
            { ...aTile(FIRST, 'github'), kind: 'app', state: 'awaitingCrew' },
            { ...aTile(SECOND, 'reviewer'), state: 'blocked', note: 'needs a review' },
          ],
          nextCursor: null,
          counts: { ships: 2, alert: 0, awaitingCrew: 1, blocked: 1, working: 0, idle: 0 },
        }),
      ],
    ]);

    await expect(createActiveShips(base).list(AS_ACCOUNT)).resolves.toEqual({
      isOk: true,
      value: [
        { shipId: FIRST, name: 'github', kind: 'app', state: 'awaitingCrew', note: null, lastActivityAt: null },
        { shipId: SECOND, name: 'reviewer', kind: 'agent', state: 'blocked', note: 'needs a review', lastActivityAt: null },
      ],
    });
  });

  it("answers the fleet's refusal", async () => {
    pages = new Map([[undefined, { status: 403, body: { error: { message: 'fleet.harbour needs the fleet:read scope', data: { code: 'FORBIDDEN' } } } }]]);

    await expect(createActiveShips(base).list(AS_ACCOUNT)).resolves.toEqual({ isOk: false, error: { code: 'FORBIDDEN', message: 'fleet.harbour needs the fleet:read scope' } });
  });

  it('answers the fleet unavailable when a page is not a page of tiles', async () => {
    pages = new Map([[undefined, answer([aTile(FIRST, 'scout')])]]);

    await expect(createActiveShips(base).list(AS_ACCOUNT)).resolves.toEqual({ isOk: false, error: { code: 'UNAVAILABLE', message: 'The fleet answered no ships' } });
  });
});

describe("the count of ships with an alert, read from the fleet's Harbour numbers", () => {
  const AS_ACCOUNT = { crewToken: 'aeolus_ct_v1_gateway', accountToken: 'aeolus_at_v1_thomas' };

  it('reads one tile of the first page however many ships the fleet holds, and answers the alert number core counted', async () => {
    pages = new Map([[undefined, answer({ items: [aTile(FIRST, 'scout')], nextCursor: 'next-page', counts: { ships: 3000, alert: 7, waiting: 10, working: 20, idle: 2963 } })]]);

    await expect(createActiveShips(base).alertCount(AS_ACCOUNT)).resolves.toEqual({ isOk: true, value: 7 });
    expect(asked).toEqual([{ path: '/trpc/fleet.harbour', input: { limit: 1 }, authorization: 'Bearer aeolus_ct_v1_gateway' }]);
  });

  it("answers the fleet's refusal", async () => {
    pages = new Map([[undefined, { status: 403, body: { error: { message: 'fleet.harbour needs the fleet:read scope', data: { code: 'FORBIDDEN' } } } }]]);

    await expect(createActiveShips(base).alertCount(AS_ACCOUNT)).resolves.toEqual({ isOk: false, error: { code: 'FORBIDDEN', message: 'fleet.harbour needs the fleet:read scope' } });
  });

  it('answers the fleet unavailable when the first page carries no numbers', async () => {
    pages = new Map([[undefined, answer({ items: [], nextCursor: null, counts: null })]]);

    await expect(createActiveShips(base).alertCount(AS_ACCOUNT)).resolves.toEqual({ isOk: false, error: { code: 'UNAVAILABLE', message: 'The fleet answered no numbers' } });
  });
});
