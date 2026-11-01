import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createActiveShips } from '../src/adapters/fleet/active-ships.js';
import { commission, register, retire, signIn } from './support/argo.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';

// Your fleet reads the fleet's active ships from a real core (fleet.list): core
// takes the filter that leaves retired ships out in its own query, and answers
// each ship's kind and its crew's report.

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

describe("the fleet's active ships, from a real core", () => {
  it("answers each active ship with its kind and its crew's report, and no retired ship", async () => {
    const reader = await commission(fleet, { cookie, ship: { name: 'reader', type: 'agent', scopes: ['fleet:read'] } });
    const readerToken = await register(fleet, reader);
    await report(readerToken, { state: 'working', note: 'reading the fleet' });
    const github = await commission(fleet, { cookie, ship: { name: 'github', type: 'mcp-server', kind: 'app' } });
    const gone = await commission(fleet, { cookie, ship: { name: 'gone', type: 'agent' } });
    await retire(fleet, { cookie, shipId: gone.shipId });

    const listed = await createActiveShips(fleet.url).list({ crewToken: readerToken });

    expect(listed.isOk ? listed.value.filter(({ name }) => ['reader', 'github', 'gone'].includes(name)) : listed).toEqual([
      { shipId: github.shipId, name: 'github', kind: 'app', status: 'awaitingCrew', report: null, openAlertCount: 0 },
      { shipId: reader.shipId, name: 'reader', kind: 'agent', status: 'crewed', report: { state: 'working', note: 'reading the fleet' }, openAlertCount: 0 },
    ]);
  });
});
