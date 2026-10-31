import { receiveOutputSchema } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';

import { createRestFleetDoor } from '../src/adapters/fleet/rest-fleet-door.js';
import { createPrismaClient } from '../src/adapters/prisma/client.js';
import type { PersonShipDoor } from '../src/core/people/ports.js';
import { applyEmptyOwnRules, commission, register, signIn } from './support/argo.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';

// The fleet's calls the gateway makes as the crew of a person ship, against a
// real core: what the ship may send to, and the person's own message
// (aeolus-fleet #1046). The fleet decides both; its refusals say why.

const QUESTION = 'application/vnd.aeolus.question+json';

let fleet: FleetServer;
let cookie: string;
let door: PersonShipDoor;
/** Charlotte's person ship's crew token. */
let charlotte: string;
/** The issue tracker's crew token. */
let tracker: string;

beforeEach(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  cookie = await signIn(fleet);
  door = createRestFleetDoor(fleet.url).person;
  charlotte = await register(fleet, await commission(fleet, { cookie, ship: { name: 'charlotte', type: 'person', kind: 'person' } }));
  tracker = await register(fleet, await commission(fleet, { cookie, ship: { name: 'tracker', type: 'issue-tracker', kind: 'app' } }));
  const stated = await fetch(`${fleet.url}/api/v1/ship/setStatement`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tracker}` },
    body: JSON.stringify({ summary: 'The issue tracker', capabilities: [{ name: 'open-issue', description: 'Opens an issue' }] }),
  });
  expect(stated.status).toBe(200);
});

afterEach(async () => {
  await fleet.stop();
});

/** What waits for the tracker, as its crew receives it. */
async function trackerReceives() {
  const response = await fetch(`${fleet.url}/api/v1/ship/receive`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tracker}` },
    body: JSON.stringify({ max: 10 }),
  });
  return receiveOutputSchema.parse(await response.json()).deliveries.map(({ senderName, contentType, payload }) => ({ senderName, contentType, payload }));
}

describe('a person ship discovers what it may send to', () => {
  it('finds each ship by name, with its type, kind and statement, and each type', async () => {
    const found = await door.discover(charlotte);

    expect(found.isOk && { tracker: found.value.ships.find(({ name }) => name === 'tracker'), type: found.value.types.find(({ type }) => type === 'issue-tracker') }).toEqual({
      tracker: { name: 'tracker', type: 'issue-tracker', kind: 'app', statement: { by: 'crew', version: 1, summary: 'The issue tracker', capabilities: [{ name: 'open-issue', description: 'Opens an issue' }] } },
      type: { type: 'issue-tracker', reachable: 1 },
    });
  });

  it('finds no ship the network rules do not let it send to', async () => {
    await applyEmptyOwnRules(fleet, cookie);

    const found = await door.discover(charlotte);

    expect(found.isOk && found.value.ships.map(({ name }) => name)).not.toContain('tracker');
  });
});

describe("a person ship sends the person's own message", () => {
  it('reaches a ship by its name, a question with numbered options as its content type says', async () => {
    const question = JSON.stringify({ id: '0b6f2a52-6a43-4a43-9a43-3f3c3b9b1a10', title: 'Which release?', context: '', options: [{ key: 1, label: '1.4' }, { key: 2, label: '1.5' }] });

    const sent = await door.send(charlotte, { to: { kind: 'ship', name: 'tracker' }, contentType: QUESTION, payload: question, idempotencyKey: 'charlotte-1' });

    expect(sent.isOk && sent.value.messageId.startsWith('msg_')).toBe(true);
    await expect(trackerReceives()).resolves.toEqual([{ senderName: 'charlotte', contentType: QUESTION, payload: question }]);
  });

  it('reaches any ship of a type', async () => {
    await door.send(charlotte, { to: { kind: 'type', type: 'issue-tracker' }, contentType: 'text/plain', payload: 'The build is red', idempotencyKey: 'charlotte-2' });

    await expect(trackerReceives()).resolves.toEqual([{ senderName: 'charlotte', contentType: 'text/plain', payload: 'The build is red' }]);
  });

  it('is refused for a name no active ship has, saying so', async () => {
    const sent = await door.send(charlotte, { to: { kind: 'ship', name: 'nobody' }, contentType: 'text/plain', payload: 'Hello', idempotencyKey: 'charlotte-3' });

    expect(!sent.isOk && sent.error.message).toContain('No active ship is named nobody');
  });

  it('is refused when no network rule lets it send there, saying so', async () => {
    await applyEmptyOwnRules(fleet, cookie);

    const sent = await door.send(charlotte, { to: { kind: 'ship', name: 'tracker' }, contentType: 'text/plain', payload: 'Hello', idempotencyKey: 'charlotte-4' });

    expect(sent).toMatchObject({ isOk: false, error: { message: 'The network rules do not allow this send' } });
  });

  it('a payload of exactly 256 KB goes (chatgpt-plugin design, 9: the limits)', async () => {
    const sent = await door.send(charlotte, { to: { kind: 'ship', name: 'tracker' }, contentType: 'text/plain', payload: 'x'.repeat(262_144), idempotencyKey: 'charlotte-256k' });

    expect(sent.isOk).toBe(true);
  });

  it('a retried send with the same key is sent once: the receiver holds one message (chatgpt-plugin design, 9: the tools)', async () => {
    const first = await door.send(charlotte, { to: { kind: 'ship', name: 'tracker' }, contentType: 'text/plain', payload: 'standup moved to 10:00', idempotencyKey: 'charlotte-retry' });
    const again = await door.send(charlotte, { to: { kind: 'ship', name: 'tracker' }, contentType: 'text/plain', payload: 'standup moved to 10:00', idempotencyKey: 'charlotte-retry' });

    expect({ first: first.isOk, again: again.isOk }).toEqual({ first: true, again: true });
    await expect(trackerReceives()).resolves.toEqual([{ senderName: 'charlotte', contentType: 'text/plain', payload: 'standup moved to 10:00' }]);
  });

  it('no message is lost when the gateway restarts mid-send: the same send with the same key, from a new gateway, is told sent as the same message, and the receiver holds one', async () => {
    const taken = await door.send(charlotte, { to: { kind: 'ship', name: 'tracker' }, contentType: 'text/plain', payload: 'standup moved to 10:00', idempotencyKey: 'charlotte-restart' });
    // The gateway restarts before its tool answered: a new door, holding nothing of the first.
    const restarted = createRestFleetDoor(fleet.url).person;

    const again = await restarted.send(charlotte, { to: { kind: 'ship', name: 'tracker' }, contentType: 'text/plain', payload: 'standup moved to 10:00', idempotencyKey: 'charlotte-restart' });

    expect(again).toEqual(taken);
    await expect(trackerReceives()).resolves.toEqual([{ senderName: 'charlotte', contentType: 'text/plain', payload: 'standup moved to 10:00' }]);
  });

  it('is refused a payload over 256 KB, saying so', async () => {
    const sent = await door.send(charlotte, { to: { kind: 'ship', name: 'tracker' }, contentType: 'text/plain', payload: 'x'.repeat(262_145), idempotencyKey: 'charlotte-5' });

    expect(!sent.isOk && sent.error.message).toContain('256 KB');
  });
});

describe('a person ship reads again a delivery the person opened (aeolus-fleet #1046)', () => {
  /** The tracker sends charlotte a message; charlotte's crew takes it and acknowledges it, as the person opening it does. */
  async function charlotteOpensTheTrackersMessage() {
    const sent = await fetch(`${fleet.url}/api/v1/ship/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tracker}` },
      body: JSON.stringify({ selector: { kind: 'ship', name: 'charlotte' }, contentType: 'text/plain', payload: 'Issue 7 is closed', idempotencyKey: 'tracker-1' }),
    });
    expect(sent.status).toBe(200);
    const taken = await door.pushReceive(charlotte, { max: 1 });
    const [opened] = taken.isOk ? taken.value : [];
    if (opened === undefined) {
      throw new Error('charlotte received no delivery');
    }
    expect((await door.ack(charlotte, opened.deliveryId)).isOk).toBe(true);
    return opened;
  }

  it('reads it again whole by its id while it is not handled', async () => {
    const opened = await charlotteOpensTheTrackersMessage();

    const again = await door.delivery(charlotte, opened.deliveryId);

    expect(again).toMatchObject({ isOk: true, value: { deliveryId: opened.deliveryId, messageId: opened.messageId, senderName: 'tracker', contentType: 'text/plain', payload: 'Issue 7 is closed' } });
  });

  it('is refused once the person dealt with it, saying why', async () => {
    const opened = await charlotteOpensTheTrackersMessage();
    expect((await door.handled(charlotte, opened.deliveryId)).isOk).toBe(true);

    const again = await door.delivery(charlotte, opened.deliveryId);

    expect(again.isOk).toBe(false);
    expect(!again.isOk && again.error.message).not.toBe('');
  });
});

describe("a person ship's inbox, as the gateway's waiter asks it (wake a person, W5)", () => {
  /** The tracker sends charlotte a note. */
  async function trackerSendsCharlotte(key: string) {
    const sent = await fetch(`${fleet.url}/api/v1/ship/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tracker}` },
      body: JSON.stringify({ selector: { kind: 'ship', name: 'charlotte' }, contentType: 'text/plain', payload: 'Issue 7 is closed', idempotencyKey: key }),
    });
    expect(sent.status).toBe(200);
  }

  it('waits while the count is the one the crew knows, and answers the new count once a delivery comes', async () => {
    const stop = new AbortController();
    const progress = { isAnswered: false };
    const asked = door.inbox(charlotte, { knownWaiting: 0, signal: stop.signal }).then((answered) => {
      progress.isAnswered = true;
      return answered;
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const isAnsweredBeforeTheSend = progress.isAnswered;

    await trackerSendsCharlotte('tracker-wait-1');

    await expect(asked).resolves.toEqual({ isOk: true, value: { waiting: 1 } });
    expect(isAnsweredBeforeTheSend).toBe(false);
  });

  it('answers at once when the count already differs from the one the crew knows', async () => {
    await trackerSendsCharlotte('tracker-wait-2');

    await expect(door.inbox(charlotte, { knownWaiting: 0, signal: new AbortController().signal })).resolves.toEqual({ isOk: true, value: { waiting: 1 } });
  });

  it('ends the wait once stopped', async () => {
    const stop = new AbortController();
    const asked = door.inbox(charlotte, { knownWaiting: 0, signal: stop.signal });

    stop.abort();

    await expect(asked).resolves.toMatchObject({ isOk: false });
  });

  it("states the gateway as the waker of the person ship's lease at its push receive", async () => {
    await trackerSendsCharlotte('tracker-wait-3');
    await door.pushReceive(charlotte, { max: 1 });

    // Core's own database, read as is: its ship contract says no lease's waker.
    const core = createPrismaClient(fleet.databaseUrl);
    try {
      const leases = await core.$queryRaw`SELECT "waker"::text FROM "leases" l JOIN "ships" s ON s."id" = l."ship_id" AND s."fleet_id" = l."fleet_id" WHERE s."name" = 'charlotte' AND l."ended_at" IS NULL`;
      expect(leases).toEqual([{ waker: 'gateway' }]);
    } finally {
      await core.$disconnect();
    }
  });
});

describe('how big: a large inbox (chatgpt-plugin design, 9)', () => {
  /** How many deliveries wait, and how many the tracker sends at once to put them there. */
  const WAITING = 10_000;
  const AT_ONCE = 100;
  /** What aeolus_inbox reads: the count, and a page of at most 10. */
  const PAGE = 10;
  const ANSWER_WITHIN_MS = 1000;

  it(
    'a person ship with 10,000 waiting deliveries: the inbox answers within 1 second with at most 10 deliveries and the total of 10,000',
    async () => {
      for (let sent = 0; sent < WAITING; sent += AT_ONCE) {
        await Promise.all(
          Array.from({ length: AT_ONCE }, async (_unused, index) => {
            const response = await fetch(`${fleet.url}/api/v1/ship/send`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', authorization: `Bearer ${tracker}` },
              body: JSON.stringify({ selector: { kind: 'ship', name: 'charlotte' }, contentType: 'text/plain', payload: 'Issue closed', idempotencyKey: `tracker-${String(sent + index)}` }),
            });
            expect(response.status).toBe(200);
          }),
        );
      }

      const started = performance.now();
      const [counted, page] = await Promise.all([door.inbox(charlotte), door.pushReceive(charlotte, { max: PAGE })]);
      const tookMs = performance.now() - started;

      expect({ waiting: counted.isOk && counted.value.waiting, listed: page.isOk && page.value.length, isInTime: tookMs < ANSWER_WITHIN_MS }).toEqual({ waiting: WAITING, listed: PAGE, isInTime: true });
    },
    300_000,
  );
});
