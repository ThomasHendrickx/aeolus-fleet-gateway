import type { ShipId } from '@aeolus-fleet/common';
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';

import { createRestFleetDoor } from '../src/adapters/fleet/rest-fleet-door.js';
import { createHeldDeliveries, holdingDoor } from '../src/core/people/held-deliveries.js';
import { createCountWaitingOn, createReadWaitingCount, type CountWaitingOn, type ReadWaitingCount } from '../src/core/people/read-waiting-count.js';
import { commission, register, retire, signIn } from './support/argo.js';
import { FLEET_ID } from './support/fleet-fakes.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';
import { CHARLOTTE_GRANT, fakeCrewPersonShip, memoryLetGoDeliveries, memoryOpenedDeliveries, memoryPersonCrews } from './support/people-fakes.js';
import { PERSON_SHIP_ID } from './support/sign-in-fakes.js';

// What waits on Charlotte, as the app's Home indicator counts it, against a
// real core (Refs #322): a plain message contributed to a meeting is in no
// exchange, so Charlotte can never open it and it is left out.

const QUESTION = 'application/vnd.aeolus.question+json';

let fleet: FleetServer;
let cookie: string;
let readWaitingCount: ReadWaitingCount;
let countWaitingOn: CountWaitingOn;
let charlotteCrewToken: string;
/** The gateway's clock, which a test moves on. */
const time = {
  at: new Date('2026-11-08T10:00:00.000Z'),
  passes: (ms: number) => {
    time.at = new Date(time.at.getTime() + ms);
  },
};
/** The ships that send to Charlotte, by name: their ids and crew tokens. */
let senders: Map<string, { shipId: ShipId; crewToken: string }>;

beforeEach(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  cookie = await signIn(fleet);
  senders = new Map();
  const charlotte = await register(fleet, await commission(fleet, { cookie, ship: { name: 'charlotte', type: 'person', kind: 'person' } }));
  charlotteCrewToken = charlotte;
  const crews = memoryPersonCrews();
  await crews.save({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, crewToken: charlotte, crewedAt: new Date() });
  const held = createHeldDeliveries({ now: () => time.at });
  readWaitingCount = createReadWaitingCount({
    crewPersonShip: fakeCrewPersonShip(crews),
    crews,
    door: holdingDoor(createRestFleetDoor(fleet.url).person, { held, letGo: memoryLetGoDeliveries() }),
    held,
    opened: memoryOpenedDeliveries(),
  });
  countWaitingOn = createCountWaitingOn({ door: holdingDoor(createRestFleetDoor(fleet.url).person, { held, letGo: memoryLetGoDeliveries() }), held, opened: memoryOpenedDeliveries() });
});

afterEach(async () => {
  await fleet.stop();
});

async function crewed(name: string, scopes?: string[]): Promise<{ shipId: ShipId; crewToken: string }> {
  const ship = await commission(fleet, { cookie, ship: { name, type: 'agent', ...(scopes === undefined ? {} : { scopes }) } });
  const sender = { shipId: ship.shipId, crewToken: await register(fleet, ship) };
  senders.set(name, sender);
  return sender;
}

async function call(ship: { crewToken: string }, step: { procedure: string; body: unknown }): Promise<unknown> {
  const response = await fetch(`${fleet.url}/api/v1/ship/${step.procedure}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ship.crewToken}` },
    body: JSON.stringify(step.body),
  });
  if (!response.ok) {
    throw new Error(`${step.procedure} failed: ${await response.text()}`);
  }
  return response.json();
}

async function sendsToCharlotte(from: { crewToken: string }, message: { contentType: string; payload: string }): Promise<void> {
  await call(from, { procedure: 'send', body: { selector: { kind: 'ship', name: 'charlotte' }, ...message, idempotencyKey: crypto.randomUUID(), model: 'claude-opus-5-5' } });
}

async function counted(): Promise<number> {
  const read = await readWaitingCount(CHARLOTTE_GRANT);
  return read.isOk ? read.value.count : -1;
}

/** What the push wake counts: the gateway's count for the person ship, read with the crew token it holds. */
async function wakeCounted(): Promise<number> {
  const read = await countWaitingOn({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID }, charlotteCrewToken);
  return read.isOk ? read.value : -1;
}

const plain = (payload: string) => ({ contentType: 'text/plain', payload });
const question = (title: string) => ({ contentType: QUESTION, payload: JSON.stringify({ id: crypto.randomUUID(), title, context: '', options: [{ key: 1, label: 'Yes' }] }) });

describe('the count of what waits on a person leaves out the plain messages of a meeting (Refs #322)', () => {
  it('counts the question and the plain message of a live ship', async () => {
    const stayer = await crewed('stayer');
    await sendsToCharlotte(stayer, plain('Still here'));
    await sendsToCharlotte(stayer, question('Which release?'));

    expect(await counted()).toBe(2);
  });

  it('leaves out a plain message contributed to a meeting', async () => {
    const chief = await crewed('chief-of-staff', ['messages:send', 'messages:receive', 'meetings:open']);
    const opened = z.object({ meetingId: z.string() }).parse(await call(chief, { procedure: 'openMeeting', body: { ships: [{ name: 'charlotte' }], title: 'Weekly heads', idempotencyKey: crypto.randomUUID(), model: 'claude-opus-5-5' } }));
    await call(chief, { procedure: 'send', body: { selector: { kind: 'meeting', meetingId: opened.meetingId }, ...plain('For the meeting'), idempotencyKey: crypto.randomUUID(), model: 'claude-opus-5-5' } });

    expect(await counted()).toBe(0);
  });
});

describe('the count of what waits on a person leaves out the plain messages of a retired sender (Fixes #322)', () => {
  it('corrects the count a minute after a ship retires that the gateway had counted, for the count and the push wake alike', async () => {
    const stayer = await crewed('stayer');
    const leaver = await crewed('leaver');
    await sendsToCharlotte(stayer, plain('Still here'));
    await sendsToCharlotte(leaver, plain('One'));
    await sendsToCharlotte(leaver, plain('Two'));
    expect({ count: await counted(), wake: await wakeCounted() }).toEqual({ count: 3, wake: 3 });

    await retire(fleet, { cookie, shipId: leaver.shipId });
    time.passes(60_000);

    expect({ count: await counted(), wake: await wakeCounted() }).toEqual({ count: 1, wake: 1 });
  });

  it('leaves out the plain messages a ship sent before argo retired it, and keeps those of a ship still crewed, for the count and the push wake alike', async () => {
    const stayer = await crewed('stayer');
    const leaver = await crewed('leaver');
    await sendsToCharlotte(stayer, plain('Still here'));
    await sendsToCharlotte(leaver, plain('One'));
    await sendsToCharlotte(leaver, plain('Two'));

    await retire(fleet, { cookie, shipId: leaver.shipId });

    expect({ count: await counted(), wake: await wakeCounted() }).toEqual({ count: 1, wake: 1 });
  });
});
