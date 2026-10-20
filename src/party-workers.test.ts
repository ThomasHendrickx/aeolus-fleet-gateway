import type { FleetId } from '@aeolus-fleet/common';
import Fastify from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID } from '../test/support/fleet-fakes.js';
import { OWNER_SHIP_ID, PROXY_SHIP_ID, memoryPartyStore } from '../test/support/party-fakes.js';
import type { McpServerParty } from './core/parties/party.js';
import { ok } from './core/shared/result.js';
import { createPartyWorkers } from './party-workers.js';

// A crewed party's worker takes its calls only while its fleet's outside
// parties are on (interop I-3): off stops that fleet's workers, and none starts.

function aCrewedServer(fleetId: FleetId, name: string): McpServerParty {
  return {
    fleetId,
    name,
    kind: 'mcpServer',
    url: `https://${name}.example.com/mcp`,
    credential: { kind: 'bearer', token: 't' },
    concurrencyLimit: 4,
    ownerShipId: OWNER_SHIP_ID,
    state: 'crewed',
    proxyShipId: PROXY_SHIP_ID,
    secret: null,
    crewToken: `aeolus_ct_v1_${name}`,
    requestId: `r-${name}`,
    requestHash: 'h',
    approvedAt: new Date('2026-10-20T09:00:00.000Z'),
  };
}

let parties: ReturnType<typeof memoryPartyStore>;
/** The parties whose worker takes calls now. */
let running: Set<string>;
let servedFleets: Set<FleetId>;

beforeEach(async () => {
  parties = memoryPartyStore();
  running = new Set();
  servedFleets = new Set([FLEET_ID, OTHER_FLEET_ID]);
  await parties.save(aCrewedServer(FLEET_ID, 'crm'));
  await parties.save(aCrewedServer(OTHER_FLEET_ID, 'erp'));
});

function workers() {
  return createPartyWorkers({
    parties,
    stateParty: () => Promise.resolve(ok({ capabilities: [] })),
    runParty: ({ party, signal }) => {
      running.add(party.name);
      return new Promise((resolve) => {
        signal.addEventListener('abort', () => {
          running.delete(party.name);
          resolve({ ended: 'stopped' });
        });
      });
    },
    collectReplies: () => Promise.resolve({ ended: 'stopped' }),
    servesOutsideParties: (fleetId) => Promise.resolve(servedFleets.has(fleetId)),
    log: Fastify({ logger: false }).log,
  });
}

/** Lets started workers reach their first step. */
const settled = () => new Promise((resolve) => setImmediate(resolve));

describe("the parties' workers", () => {
  it("start no worker while the fleet's outside parties are off", async () => {
    servedFleets.delete(FLEET_ID);
    const pool = workers();

    await pool.start({ fleetId: FLEET_ID, name: 'crm' });
    await settled();

    expect([...running]).toEqual([]);
    await pool.stop();
  });

  it("stop one fleet's workers only, once its outside parties go off", async () => {
    const pool = workers();
    await pool.start({ fleetId: FLEET_ID, name: 'crm' });
    await pool.start({ fleetId: OTHER_FLEET_ID, name: 'erp' });
    await settled();

    await pool.stopFleet(FLEET_ID);

    expect([...running]).toEqual(['erp']);
    await pool.stop();
  });

  it("start a fleet's workers again once its outside parties are on again", async () => {
    const pool = workers();
    await pool.start({ fleetId: FLEET_ID, name: 'crm' });
    await settled();
    await pool.stopFleet(FLEET_ID);

    await pool.start({ fleetId: FLEET_ID, name: 'crm' });
    await settled();

    expect([...running]).toEqual(['crm']);
    await pool.stop();
  });
});
