import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createActiveShips } from '../src/adapters/fleet/active-ships.js';
import { commission, register, retire, signIn } from './support/argo.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';

// Your fleet reads the fleet's active ships from a real core (fleet.harbour): core
// leaves retired ships out, and answers each ship's kind, state, its crew's
// note and when it last did something.

let fleet: FleetServer;
let cookie: string;

beforeAll(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  cookie = await signIn(fleet);
}, 120_000);

afterAll(async () => {
  await fleet.stop();
});

async function report(crewToken: string, input: { state: 'working' | 'blocked' | 'idle'; note: string }): Promise<void> {
  const response = await fetch(`${fleet.url}/api/v1/ship/report`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${crewToken}` }, body: JSON.stringify(input) });
  expect(response.ok).toBe(true);
}

async function send(crewToken: string, input: { to: string; idempotencyKey: string }): Promise<void> {
  const response = await fetch(`${fleet.url}/api/v1/ship/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${crewToken}` },
    body: JSON.stringify({ selector: { kind: 'ship', name: input.to }, contentType: 'text/plain', payload: 'hello', idempotencyKey: input.idempotencyKey, model: 'claude-sonnet-5-5' }),
  });
  expect(response.status).toBe(200);
}

describe("the fleet's active ships, from a real core", () => {
  it("answers each active ship with its kind, state, note and last activity, and no retired ship", async () => {
    const reader = await commission(fleet, { cookie, ship: { name: 'reader', type: 'agent', scopes: ['fleet:read'] } });
    const readerToken = await register(fleet, reader);
    await report(readerToken, { state: 'working', note: 'reading the fleet' });
    const github = await commission(fleet, { cookie, ship: { name: 'github', type: 'mcp-server', kind: 'app' } });
    await send(readerToken, { to: 'github', idempotencyKey: 'reader-1' });
    const gone = await commission(fleet, { cookie, ship: { name: 'gone', type: 'agent' } });
    await retire(fleet, { cookie, shipId: gone.shipId });

    const listed = await createActiveShips(fleet.url).list({ crewToken: readerToken });

    expect(listed.isOk ? listed.value.filter(({ name }) => ['reader', 'github', 'gone'].includes(name)) : listed).toEqual([
      { shipId: github.shipId, name: 'github', kind: 'app', state: 'waiting', note: null, lastActivityAt: null },
      { shipId: reader.shipId, name: 'reader', kind: 'agent', state: 'working', note: 'reading the fleet', lastActivityAt: expect.stringMatching(/^2\d{3}-\d\d-\d\dT/) },
    ]);
  });
});
