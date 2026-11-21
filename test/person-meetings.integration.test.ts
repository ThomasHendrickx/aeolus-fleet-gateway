import { idSchema, inboxOutputSchema, openMeetingOutputSchema, receiveOutputSchema, type MeetingId, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';

import { createRestFleetDoor } from '../src/adapters/fleet/rest-fleet-door.js';
import type { MeetingControls } from '../src/core/meetings/control-ports.js';
import type { PersonMeetingDoor } from '../src/core/meetings/ports.js';
import type { PersonShipDoor } from '../src/core/people/ports.js';
import { createPrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaMeetingContributions } from '../src/adapters/prisma/meeting-contributions.js';
import { createRecordingMeetingDoor } from '../src/core/meetings/recording-meeting-door.js';
import { createRefreshingPersonDoor } from '../src/core/people/refreshing-person-door.js';
import { createWaitOnPersonShip } from '../src/core/people/wait-on-person-ship.js';
import { memoryPersonCrews, memoryFocusedPages, memoryQuietHours, memoryQuietShips, memoryRoutes } from './support/people-fakes.js';
import { memoryConnectionStore } from './support/fleet-fakes.js';
import { createWakePerson } from '../src/core/people/wake-person.js';
import { routingDefaultsOf } from '../src/core/people/routing.js';
import { memoryShipWakeups } from './support/ship-wakeups.js';
import { migratedDatabase } from './support/database.js';
import { commission, register, signIn } from './support/argo.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';

// A person takes part in a meeting as their person ship, against a real core
// 0.31.0 (decision 0061, M19): the chief of staff opens it and moderates, and
// the gateway, as the person ship's crew, reads it, requests the mic,
// contributes and releases the mic. Core decides every call.

let fleet: FleetServer;
let person: PersonShipDoor;
let meetings: PersonMeetingDoor;
let controls: MeetingControls;
/** Charlotte's person ship's crew token. */
let charlotte: string;
/** The chief of staff's crew token: it opens the meeting and moderates. */
let chief: string;
let meetingId: MeetingId;

/** One call of the chief of staff's crew, its answer as JSON. */
async function chiefCalls(procedure: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${fleet.url}/api/v1/ship/${procedure}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${chief}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${procedure} failed: ${await response.text()}`);
  }
  return response.json();
}

beforeEach(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  const cookie = await signIn(fleet);
  const door = createRestFleetDoor(fleet.url);
  person = door.person;
  meetings = door.meetings;
  controls = door.meetingControls;
  charlotte = await register(fleet, await commission(fleet, { cookie, ship: { name: 'charlotte', type: 'person', kind: 'person' } }));
  chief = await register(fleet, await commission(fleet, { cookie, ship: { name: 'chief-of-staff', type: 'agent', scopes: ['messages:send', 'messages:receive', 'meetings:open'] } }));
  const opened = await chiefCalls('openMeeting', { ships: [{ name: 'charlotte' }], title: 'Weekly heads', idempotencyKey: crypto.randomUUID(), model: 'claude-opus-5-5' });
  meetingId = openMeetingOutputSchema.parse(opened).meetingId;
});

afterEach(async () => {
  await fleet.stop();
});

/** The meeting's contributions as the chief of staff's crew receives them. */
async function chiefReceives() {
  const taken = receiveOutputSchema.parse(await chiefCalls('receive', { max: 10 }));
  return taken.deliveries.map(({ senderName, payload, meetingId: of }) => ({ senderName, payload, meetingId: of }));
}

/** A complete meeting burst and the person waiter that records it. */
async function aContributionBurst(isFocused: boolean) {
  const prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
  const stop = new AbortController();
  const hints = memoryShipWakeups();
  const who = await person.whoami(charlotte);
  if (!who.isOk) { throw new Error('Person ship did not answer'); }
  const ship = { fleetId: who.value.fleetId, shipId: who.value.shipId };
  const record = createPrismaMeetingContributions(prisma);
  const crews = memoryPersonCrews();
  await crews.save({ ...ship, crewToken: charlotte, crewedAt: new Date() });
  const changes = { tell: () => Promise.resolve() };
  const door = createRefreshingPersonDoor(createRecordingMeetingDoor(person, { contributions: record, changes }), () => { hints.wake(); });
  let looks = 0;
  let receives = 0;
  const focused = memoryFocusedPages();
  if (isFocused) { await focused.save({ ...ship, pageId: 'meeting-page', seenAt: new Date() }); }
  const wakePerson = createWakePerson({
    door, connections: memoryConnectionStore(), channels: [], routes: memoryRoutes(), defaults: routingDefaultsOf([]),
    quietHours: memoryQuietHours(), quietShips: memoryQuietShips(), focused, focusFreshMs: 60_000,
    wakesSent: { lastSentAt: () => Promise.resolve(undefined), record: () => Promise.resolve() },
    clock: { now: () => new Date() }, attemptEnded: () => undefined,
  });
  const wait = createWaitOnPersonShip({
    crews, wakeups: hints.open, changes,
    door: { inbox: async (token, options) => { const answer = await door.inbox(token, options); looks += 1; return answer; } },
    wakePerson: async (_ship, token) => {
      receives += 1;
      return wakePerson(ship, token);
    },
    isServed: () => Promise.resolve(true), clock: { now: () => new Date() },
    sleep: () => new Promise(() => undefined), againWaitsMs: [100], wakeAgainWaitsMs: [100],
  });
  for (let number = 0; number < 120; number += 1) {
    await chiefCalls('send', { selector: { kind: 'meeting', meetingId }, payload: `Contribution ${String(number)}`, idempotencyKey: `burst-${String(number)}`, model: 'gpt-6.1-sol' });
  }
  const done = wait(ship, stop.signal);
  await expect.poll(() => hints.leases.length).toBe(1);
  hints.wake();
  return {
    ship, record, prisma, hints,
    receives: () => receives,
    looks: () => looks,
    recorded: () => expect.poll(async () => (await record.unseen(ship, [meetingId]))[0]?.count).toBe(120),
    close: async () => { stop.abort(); await done; await prisma.$disconnect(); },
  };
}

async function withContributionBurst(isFocused: boolean, check: (burst: Awaited<ReturnType<typeof aContributionBurst>>) => Promise<void>) {
  const burst = await aContributionBurst(isFocused);
  try { await check(burst); } finally { await burst.close(); }
}

describe('a person ship takes part in a meeting', () => {
  it.each([false, true])('counts the complete burst without another event with page focused: %s', async (isFocused) => {
    await withContributionBurst(isFocused, async (burst) => {
      await burst.recorded();
    });
  }, 60_000);

  it.each([false, true])('shares the complete burst count with a second device with page focused: %s', async (isFocused) => {
    await withContributionBurst(isFocused, async (burst) => {
      await burst.recorded();
      await expect(createPrismaMeetingContributions(burst.prisma).unseen(burst.ship, [meetingId])).resolves.toEqual([{ meetingId, count: 120 }]);
    });
  }, 60_000);

  it.each([false, true])('leaves only the meeting notice waiting in core with page focused: %s', async (isFocused) => {
    await withContributionBurst(isFocused, async (burst) => {
      await burst.recorded();
      expect(await person.inbox(charlotte)).toMatchObject({ isOk: true, value: { waiting: 1 } });
    });
  }, 60_000);

  it.each([false, true])('stops receiving after the burst is recorded with page focused: %s', async (isFocused) => {
    await withContributionBurst(isFocused, async (burst) => {
      await burst.recorded();
      const received = burst.receives();
      const looked = burst.looks();
      burst.hints.wake();
      await expect.poll(burst.looks).toBeGreaterThan(looked);
      expect(burst.receives()).toBe(received);
    });
  }, 60_000);

  it('keeps contributions outside the ship conversation and its plain message counts', async () => {
    await chiefCalls('send', { selector: { kind: 'meeting', meetingId }, payload: 'Meeting only', idempotencyKey: 'meeting-only', model: 'gpt-6.1-sol' });
    const who = await person.whoami(chief);
    expect(who.isOk).toBe(true);
    if (!who.isOk) { return; }
    const exchange = await person.exchange(charlotte, { otherShipId: who.value.shipId, start: { kind: 'newest' }, limit: 20 });
    const exchanges = await person.exchanges(charlotte, { cursor: null, limit: 20 });
    expect(exchange.isOk && exchange.value.items.map(({ payload }) => payload)).not.toContain('Meeting only');
    expect(exchanges.isOk && exchanges.value.items.every(({ unseenPlainMessages }) => unseenPlainMessages === 0)).toBe(true);
  });

  it("finds the meeting by the added notice's envelope", async () => {
    const taken = await person.pushReceive(charlotte, { max: 10 });

    expect(taken.isOk && taken.value.map(({ senderName, contentType, meetingId: of }) => ({ senderName, contentType, meetingId: of }))).toEqual([
      { senderName: 'chief-of-staff', contentType: 'application/vnd.aeolus.meeting.added+json', meetingId },
    ]);
  });

  it('reads the meeting: its owner and moderator, its participants and its free mic', async () => {
    const read = await meetings.meeting(charlotte, { meetingId });

    expect(read).toMatchObject({
      isOk: true,
      value: {
        meetingId,
        title: 'Weekly heads',
        owner: { name: 'chief-of-staff' },
        moderator: { name: 'chief-of-staff' },
        endedAt: null,
        participants: [
          { name: 'chief-of-staff', state: 'present' },
          { name: 'charlotte', kind: 'person', state: 'present' },
        ],
        mic: { holder: null, requests: [] },
        contributions: { items: [], nextCursor: null },
      },
    });
  });

  it('is refused a contribution without the mic, storing nothing', async () => {
    const sent = await person.send(charlotte, { to: { kind: 'meeting', meetingId }, contentType: 'text/plain', payload: 'Marketing is on track', idempotencyKey: 'charlotte-1' });

    expect(sent.isOk).toBe(false);
    expect(!sent.isOk && sent.error.message).toMatch(/mic/i);
    expect(inboxOutputSchema.parse(await chiefCalls('inbox', {})).waiting).toBe(0);
  });

  it('requests the mic, gets it first in line, contributes to every other participant and releases it', async () => {
    await chiefCalls('setMicPattern', { meetingId, pattern: 'fifo' });

    await expect(meetings.changeMic(charlotte, { meetingId, change: 'request' })).resolves.toEqual({ isOk: true, value: { kind: 'holding' } });
    const holding = await meetings.meeting(charlotte, { meetingId });
    const sent = await person.send(charlotte, { to: { kind: 'meeting', meetingId }, contentType: 'text/plain', payload: 'Marketing is on track', idempotencyKey: 'charlotte-2' });
    await expect(meetings.changeMic(charlotte, { meetingId, change: 'release' })).resolves.toEqual({ isOk: true, value: { kind: 'none' } });
    const released = await meetings.meeting(charlotte, { meetingId });

    expect(holding.isOk && holding.value.mic.holder?.name).toBe('charlotte');
    expect(sent.isOk && idSchema('message').safeParse(sent.value.messageId).success).toBe(true);
    await expect(chiefReceives()).resolves.toEqual([{ senderName: 'charlotte', payload: 'Marketing is on track', meetingId }]);
    expect(released.isOk && { holder: released.value.mic.holder, contributions: released.value.contributions.items.map(({ sender, payload }) => ({ sender: sender.name, payload })) }).toEqual({
      holder: null,
      contributions: [{ sender: 'charlotte', payload: 'Marketing is on track' }],
    });
  });

  it('withdraws a request that waits in line, leaving the line', async () => {
    await meetings.changeMic(charlotte, { meetingId, change: 'request' });

    await expect(meetings.changeMic(charlotte, { meetingId, change: 'withdraw' })).resolves.toEqual({ isOk: true, value: { kind: 'none' } });
    const read = await meetings.meeting(charlotte, { meetingId });

    expect(read.isOk && read.value.mic.requests).toEqual([]);
  });

  it('is refused a second request, saying why', async () => {
    await meetings.changeMic(charlotte, { meetingId, change: 'request' });

    const again = await meetings.changeMic(charlotte, { meetingId, change: 'request' });

    expect(again.isOk).toBe(false);
    expect(!again.isOk && again.error.message).not.toBe('');
  });

  it('is refused a meeting it takes no part in', async () => {
    const read = await meetings.meeting(charlotte, { meetingId: 'mtg_01m5qa5j85mgd4z61d9c2k4zzz' });

    expect(read.isOk).toBe(false);
  });
});

describe('the person meeting controls against core main', () => {
  it('lists former participation, then rejoins, with an opaque bounded cursor', async () => {
    await expect(controls.change(charlotte, { call: 'leaveMeeting', input: { meetingId } })).resolves.toEqual({ isOk: true, value: {} });
    const page = await controls.list(charlotte, { limit: 20 });
    expect(page).toMatchObject({ isOk: true, value: { items: [{ meetingId, participantState: 'left', title: 'Weekly heads' }], nextCursor: null } });
    await expect(controls.change(charlotte, { call: 'rejoinMeeting', input: { meetingId } })).resolves.toEqual({ isOk: true, value: {} });
    const present = await controls.list(charlotte, { limit: 20 });
    expect(present).toMatchObject({ isOk: true, value: { items: [{ meetingId, participantState: 'present' }] } });
  });

  it('refuses opening without meetings:open and states the scope', async () => {
    const opened = await controls.change(charlotte, { call: 'openMeeting', input: { ships: [{ name: 'chief-of-staff' }], idempotencyKey: 'person-open' } });
    expect(opened).toMatchObject({ isOk: false, error: { code: 'FORBIDDEN' } });
    expect(!opened.isOk && opened.error.message).toContain('meetings:open');
  });

  describe('the person owns a meeting with the granted scope', () => {
    let owner: string;
    let owned: MeetingId;
    let shipId: ShipId;

    beforeEach(async () => {
      const cookie = await signIn(fleet);
      owner = await register(fleet, await commission(fleet, { cookie, ship: { name: 'owner', type: 'person', kind: 'person', scopes: ['meetings:open'] } }));
      const opened = await controls.change(owner, { call: 'openMeeting', input: { ships: [{ name: 'charlotte' }], title: 'Person runs it', idempotencyKey: crypto.randomUUID() } });
      if (!opened.isOk || opened.value.meetingId === undefined) throw new Error('Meeting did not open');
      owned = opened.value.meetingId;
      const read = await meetings.meeting(owner, { meetingId: owned });
      if (!read.isOk) throw new Error('Meeting did not read');
      const participant = read.value.participants.find(({ name }) => name === 'charlotte');
      if (participant === undefined) throw new Error('Charlotte is not a participant');
      shipId = participant.shipId;
    });

    it('opens as owner and moderator with the granted scope', async () => {
      await expect(meetings.meeting(owner, { meetingId: owned })).resolves.toMatchObject({ isOk: true, value: { title: 'Person runs it', owner: { name: 'owner' }, moderator: { name: 'owner' } } });
    });

    it('gives the mic to a participant', async () => {
      await controls.change(owner, { call: 'giveMic', input: { meetingId: owned, shipId } });
      await expect(meetings.meeting(owner, { meetingId: owned })).resolves.toMatchObject({ isOk: true, value: { mic: { holder: { name: 'charlotte' } } } });
    });

    it('takes the mic back from a participant', async () => {
      await controls.change(owner, { call: 'giveMic', input: { meetingId: owned, shipId } });
      await controls.change(owner, { call: 'takeMic', input: { meetingId: owned } });
      await expect(meetings.meeting(owner, { meetingId: owned })).resolves.toMatchObject({ isOk: true, value: { mic: { holder: null } } });
    });

    it('changes the mic pattern', async () => {
      await controls.change(owner, { call: 'setMicPattern', input: { meetingId: owned, pattern: 'fifo' } });
      await expect(meetings.meeting(owner, { meetingId: owned })).resolves.toMatchObject({ isOk: true, value: { mic: { pattern: 'fifo' } } });
    });

    it('revokes a participant', async () => {
      await controls.change(owner, { call: 'revokeFromMeeting', input: { meetingId: owned, shipId } });
      const revoked = await controls.list(charlotte, { limit: 20 });
      expect(revoked.isOk && revoked.value.items.find(({ meetingId: id }) => id === owned)?.participantState).toBe('revoked');
    });

    it('adds a revoked participant by name', async () => {
      await controls.change(owner, { call: 'revokeFromMeeting', input: { meetingId: owned, shipId } });
      await controls.change(owner, { call: 'addToMeeting', input: { meetingId: owned, ships: [{ name: 'charlotte' }] } });
      const added = await controls.list(charlotte, { limit: 20 });
      expect(added.isOk && added.value.items.find(({ meetingId: id }) => id === owned)?.participantState).toBe('present');
    });

    it('names a participant as moderator', async () => {
      await controls.change(owner, { call: 'nameModerator', input: { meetingId: owned, shipId } });
      await expect(meetings.meeting(owner, { meetingId: owned })).resolves.toMatchObject({ isOk: true, value: { moderator: { name: 'charlotte' } } });
    });

    it('transfers ownership to a participant', async () => {
      await controls.change(owner, { call: 'transferMeeting', input: { meetingId: owned, shipId } });
      await expect(meetings.meeting(charlotte, { meetingId: owned })).resolves.toMatchObject({ isOk: true, value: { owner: { name: 'charlotte' } } });
    });

    it('ends the meeting', async () => {
      await controls.change(owner, { call: 'endMeeting', input: { meetingId: owned } });
      const ended = await meetings.meeting(owner, { meetingId: owned });
      expect(ended.isOk && ended.value.endedAt instanceof Date).toBe(true);
    });

    it('passes the refusal after the meeting ended on', async () => {
      await controls.change(owner, { call: 'endMeeting', input: { meetingId: owned } });
      const ended = await controls.change(owner, { call: 'takeMic', input: { meetingId: owned } });
      expect(!ended.isOk && ended.error.message).toMatch(/ended/i);
    });
  });
});
