import { receiveOutputSchema } from '@aeolus-fleet/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { createRestFleetDoor } from '../src/adapters/fleet/rest-fleet-door.js';
import { createPrismaUnreadableReplies } from '../src/adapters/prisma/unreadable-replies.js';
import { createPrismaOpenedDeliveries } from '../src/adapters/prisma/opened-deliveries.js';
import { err } from '../src/core/shared/result.js';
import { createReadablePersonDoor } from '../src/core/people/readable-person-door.js';
import { FIXED_CLOCK } from './support/fixed-clock.js';
import { migratedDatabase } from './support/database.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { exchangeRefusalOf } from '../src/core/people/exchange.js';
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
    const trackerId = found.isOk ? (found.value.ships.find(({ name }) => name === 'tracker')?.id ?? '') : '';

    expect(trackerId).toMatch(/^shp_/);
    expect(found.isOk && { tracker: found.value.ships.find(({ name }) => name === 'tracker'), type: found.value.types.find(({ type }) => type === 'issue-tracker') }).toEqual({
      tracker: { id: trackerId, name: 'tracker', type: 'issue-tracker', kind: 'app', statement: { by: 'crew', version: 1, summary: 'The issue tracker', capabilities: [{ name: 'open-issue', description: 'Opens an issue' }] } },
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

describe("a person ship reads its exchange with one ship (aeolus-fleet exchange-read, section 7)", () => {
  it('carries the person ship\'s own delivery of a message it received, whose id answers it, and none on its own message', async () => {
    const sent = await fetch(`${fleet.url}/api/v1/ship/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tracker}` },
      body: JSON.stringify({ selector: { kind: 'ship', name: 'charlotte' }, contentType: 'text/plain', payload: 'Issue 7 is closed', idempotencyKey: 'tracker-1' }),
    });
    expect(sent.status).toBe(200);
    const taken = await door.pushReceive(charlotte, { max: 1 });
    const [received] = taken.isOk ? taken.value : [];
    if (received === undefined) {
      throw new Error('charlotte received no delivery');
    }
    expect((await door.ack(charlotte, received.deliveryId)).isOk).toBe(true);
    const replied = await door.reply(charlotte, { to: received.senderShipId, inReplyTo: received.messageId, contentType: 'text/plain', payload: 'Thanks', idempotencyKey: 'charlotte-1' });
    expect(replied.isOk).toBe(true);

    const page = await door.exchange(charlotte, { otherShipId: received.senderShipId, start: { kind: 'newest' }, limit: 20 });

    expect(page.isOk && page.value.items.map(({ payload, receivedDelivery }) => ({ payload, receivedDelivery }))).toEqual([
      { payload: 'Thanks', receivedDelivery: null },
      { payload: 'Issue 7 is closed', receivedDelivery: { deliveryId: received.deliveryId, state: 'acknowledged' } },
    ]);
    const delivery = page.isOk ? page.value.items[1]?.receivedDelivery : null;
    expect((await door.handled(charlotte, delivery?.deliveryId ?? received.deliveryId)).isOk).toBe(true);
  });
});

describe('a person ship reads an exchange that is not there (aeolus-fleet exchange-read, section 7)', () => {
  async function trackerShipId() {
    const found = await door.discover(charlotte);
    const tracker = found.isOk ? found.value.ships.find(({ name }) => name === 'tracker') : undefined;
    if (tracker === undefined) {
      throw new Error('charlotte does not find the tracker');
    }
    return tracker.id;
  }

  it('means a message not in the exchange as no such message', async () => {
    const trackerId = await trackerShipId();

    const page = await door.exchange(charlotte, { otherShipId: trackerId, start: { kind: 'around', messageId: 'msg_01m3tbfspe96yf1rnr4ank0001' }, limit: 20 });

    expect(!page.isOk && exchangeRefusalOf(page.error, { doing: 'The exchange cannot be read', missing: 'message' }).error.kind).toBe('NO_SUCH_MESSAGE');
  });

  it('means a message not from that ship to the person ship, marked seen, as no such message', async () => {
    const trackerId = await trackerShipId();

    const marked = await door.ackUpTo(charlotte, { otherShipId: trackerId, messageId: 'msg_01m3tbfspe96yf1rnr4ank0001' });

    expect(!marked.isOk && exchangeRefusalOf(marked.error, { doing: 'The exchange cannot be marked seen', missing: 'message' }).error.kind).toBe('NO_SUCH_MESSAGE');
  });

  it('means a ship that is not in the fleet as no such ship', async () => {
    const page = await door.exchange(charlotte, { otherShipId: 'shp_01m3tbfspe96yf1rnr4ank0001', start: { kind: 'newest' }, limit: 20 });

    expect(!page.isOk && exchangeRefusalOf(page.error, { doing: 'The exchange cannot be read', missing: 'ship' }).error.kind).toBe('NO_SUCH_SHIP');
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

describe('a malformed question or step never reaches the person', () => {
  let prisma: PrismaClient;
  beforeAll(async () => {
    prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  it.each(['application/vnd.aeolus.question+json', 'application/vnd.aeolus.step+json'])('returns and handles %s once across concurrent reads and a gateway restart', async (contentType) => {
    const opened = createPrismaOpenedDeliveries(prisma);
    const sent = await fetch(`${fleet.url}/api/v1/ship/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tracker}` },
      body: JSON.stringify({ selector: { kind: 'ship', name: 'charlotte' }, contentType, payload: '{}', idempotencyKey: 'malformed' }),
    });
    expect(sent.status).toBe(200);
    const received = await door.pushReceive(charlotte, { max: 10 });
    const delivery = received.isOk ? received.value[0] : undefined;
    if (delivery === undefined) {
      throw new Error('The malformed delivery did not arrive');
    }
    const unavailable = { code: 'UNAVAILABLE', message: 'The gateway stopped before handling' };
    const interrupted = createReadablePersonDoor({ ...door, handled: () => Promise.resolve(err(unavailable)) }, { opened, replies: createPrismaUnreadableReplies(prisma), clock: FIXED_CLOCK });
    expect(await interrupted.pushReceive(charlotte, { max: 10 })).toEqual({ isOk: false, error: unavailable });
    expect(await door.inbox(charlotte)).toEqual({ isOk: true, value: { waiting: 0 } });
    const restarted = createReadablePersonDoor(door, { opened: createPrismaOpenedDeliveries(prisma), replies: createPrismaUnreadableReplies(prisma), clock: FIXED_CLOCK });
    const recovered = await Promise.all([restarted.pushReceive(charlotte, { max: 10 }), restarted.pushReceive(charlotte, { max: 10 })]);
    expect(recovered).toEqual([{ isOk: true, value: [] }, { isOk: true, value: [] }]);
    const replies = await trackerReceives();
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ senderName: 'charlotte', contentType: 'text/plain' });
    expect(replies[0]?.payload).toContain('title');
    expect(await restarted.record(charlotte, { cursor: null, limit: 20 })).toMatchObject({ isOk: true, value: { items: [] } });
    expect(await restarted.exchange(charlotte, { otherShipId: delivery.senderShipId, start: { kind: 'newest' }, limit: 20 })).toMatchObject({ isOk: true, value: { items: [] } });
    expect(await door.record(charlotte, { cursor: null, limit: 20 })).toMatchObject({ isOk: true, value: { items: [{ state: 'handled' }] } });
    const who = await door.whoami(charlotte);
    expect(who.isOk && await opened.list(who.value.fleetId, who.value.shipId)).toEqual([]);
  });
});
