import type { DeliveryId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aPushedDelivery, fakeProxyShipCrew } from '../../../test/support/mcp-out-fakes.js';
import { OWNER_SHIP_ID, PROXY_SHIP_ID } from '../../../test/support/party-fakes.js';
import type { McpServerParty } from '../parties/party.js';
import type { HandCall, HandOutcome } from './hand-call.js';
import { createRunParty, type Sleep } from './run-party.js';

const CRM: McpServerParty = {
  fleetId: FLEET_ID,
  name: 'crm',
  kind: 'mcpServer',
  url: 'https://crm.example.com/mcp',
  credential: { kind: 'bearer', token: 'crm-token' },
  ownerShipId: OWNER_SHIP_ID,
  concurrencyLimit: 2,
  state: 'crewed',
  proxyShipId: PROXY_SHIP_ID,
  secret: null,
  crewToken: 'aeolus_ct_v1_proxy',
  requestId: 'a-1',
  requestHash: 'h',
  approvedAt: new Date('2026-10-18T14:00:00.000Z'),
};

const ONE: DeliveryId = 'dlv_01m3tbfspe96yf1rnr4ank9d01';
const TWO: DeliveryId = 'dlv_01m3tbfspe96yf1rnr4ank9d02';
const THREE: DeliveryId = 'dlv_01m3tbfspe96yf1rnr4ank9d03';

let crew: ReturnType<typeof fakeProxyShipCrew>;
let stop: AbortController;
let handed: DeliveryId[];
let outcomes: Map<DeliveryId, HandOutcome[]>;
let held: Set<DeliveryId>;
let releases: (() => void)[];
let sleeps: number[];

/** The fleet's deliveries in flight come back from pushReceive until each is handled, as core's do. */
const handCall: HandCall = async ({ delivery }) => {
  handed.push(delivery.deliveryId);
  if (held.has(delivery.deliveryId)) {
    await new Promise<void>((release) => releases.push(release));
  }
  const outcome = outcomes.get(delivery.deliveryId)?.shift() ?? { kind: 'handled' };
  if (outcome.kind !== 'again') {
    crew.state.waiting = crew.state.waiting.filter((waiting) => waiting.deliveryId !== delivery.deliveryId);
  }
  return outcome;
};

/** Each sleep lets the calls run; the run stops once nothing waits in the fleet, or after enough rounds. */
const sleep: Sleep = async (ms) => {
  sleeps.push(ms);
  await new Promise((resolve) => setImmediate(resolve));
  if (crew.state.waiting.length === 0 || sleeps.length > 50) {
    stop.abort();
  }
};

beforeEach(() => {
  crew = fakeProxyShipCrew();
  stop = new AbortController();
  handed = [];
  outcomes = new Map();
  held = new Set();
  releases = [];
  sleeps = [];
});

function run(party: McpServerParty = CRM) {
  return createRunParty({ crew, handCall, sleep, pollMs: 2_000, againWaitsMs: [1_000, 5_000, 30_000] })({ party, signal: stop.signal });
}

describe('the gateway takes the calls of a proxy ship, as its crew (interop 5.2)', () => {
  it('hands each delivery once, though the fleet hands it again while it is in flight', async () => {
    crew.state.waiting = [aPushedDelivery({ deliveryId: ONE }), aPushedDelivery({ deliveryId: TWO })];

    await expect(run()).resolves.toEqual({ ended: 'stopped' });
    expect(handed).toEqual([ONE, TWO]);
  });

  it('has no more calls in flight than the party takes at once', async () => {
    crew.state.waiting = [ONE, TWO, THREE].map((deliveryId) => aPushedDelivery({ deliveryId }));
    held = new Set([ONE, TWO]);
    const running = run();
    while (releases.length < 2) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    expect(handed).toEqual([ONE, TWO]);
    releases.forEach((release) => {
      release();
    });
    await running;
    expect(handed).toEqual([ONE, TWO, THREE]);
  });

  it('asks the fleet for as many as the party takes at once', async () => {
    await run({ ...CRM, concurrencyLimit: 7 });

    expect(crew.received.at(0)).toBe(7);
  });

  it('hands a delivery answered again once its wait passed, each wait longer than the last', async () => {
    crew.state.waiting = [aPushedDelivery({ deliveryId: ONE })];
    outcomes.set(ONE, [{ kind: 'again' }, { kind: 'again' }, { kind: 'handled' }]);

    await run();

    expect({ handed, waits: sleeps.filter((ms) => ms !== 2_000) }).toEqual({ handed: [ONE, ONE, ONE], waits: [1_000, 5_000] });
  });

  it('polls again after a while when the fleet hands only what it already holds', async () => {
    crew.state.waiting = [aPushedDelivery({ deliveryId: ONE })];
    held = new Set([ONE]);
    const running = run();
    while (sleeps.length < 3) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    releases.forEach((release) => {
      release();
    });
    await running;

    expect(sleeps.slice(0, 3)).toEqual([2_000, 2_000, 2_000]);
  });

  it('ends when the fleet refuses the crew token: the proxy ship is not crewed by the gateway any more', async () => {
    crew.state.receiveRefusal = { code: 'UNAUTHORIZED', message: 'The crew token is not valid' };

    await expect(run()).resolves.toEqual({ ended: 'crewRefused' });
  });

  it('goes on after a wait while the fleet does not answer', async () => {
    crew.state.receiveRefusal = { code: 'UNAVAILABLE', message: 'The fleet did not answer' };
    crew.state.waiting = [aPushedDelivery({ deliveryId: ONE })];
    const running = run();
    while (sleeps.length < 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    crew.state.receiveRefusal = undefined;

    await expect(running).resolves.toEqual({ ended: 'stopped' });
    expect(handed).toEqual([ONE]);
  });
});
