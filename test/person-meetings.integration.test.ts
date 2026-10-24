import { idSchema, openMeetingOutputSchema, receiveOutputSchema, type MeetingId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';

import { createRestFleetDoor } from '../src/adapters/fleet/rest-fleet-door.js';
import type { PersonMeetingDoor } from '../src/core/meetings/ports.js';
import type { PersonShipDoor } from '../src/core/people/ports.js';
import { commission, register, signIn } from './support/argo.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';

// A person takes part in a meeting as their person ship, against a real core
// 0.31.0 (decision 0061, M19): the chief of staff opens it and moderates, and
// the gateway, as the person ship's crew, reads it, requests the mic,
// contributes and releases the mic. Core decides every call.

let fleet: FleetServer;
let person: PersonShipDoor;
let meetings: PersonMeetingDoor;
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

describe('a person ship takes part in a meeting', () => {
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
    await expect(chiefReceives()).resolves.toEqual([]);
  });

  it('requests the mic, gets it first in line, contributes to every other participant and releases it', async () => {
    await chiefCalls('setMicPattern', { meetingId, pattern: 'fifo' });

    await expect(meetings.changeMic(charlotte, { meetingId, change: 'request' })).resolves.toEqual({ isOk: true, value: undefined });
    const holding = await meetings.meeting(charlotte, { meetingId });
    const sent = await person.send(charlotte, { to: { kind: 'meeting', meetingId }, contentType: 'text/plain', payload: 'Marketing is on track', idempotencyKey: 'charlotte-2' });
    await expect(meetings.changeMic(charlotte, { meetingId, change: 'release' })).resolves.toEqual({ isOk: true, value: undefined });
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

    await expect(meetings.changeMic(charlotte, { meetingId, change: 'withdraw' })).resolves.toEqual({ isOk: true, value: undefined });
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
