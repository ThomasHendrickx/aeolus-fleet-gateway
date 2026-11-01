import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { CHARLOTTE_GRANT, fakeCrewPersonShip, fakePersonShipDoor, memoryInboxChanges, memoryItemOutcomes, memoryOpenedDeliveries, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import { createDoneDelivery } from './done-delivery.js';
import type { OpenedDelivery } from './ports.js';

// A person does what only a human can (Bridge, CC14, CC23): on a step they
// opened, they press Done or Cannot, with a note if they wrote one. The
// outcome goes to the asker at once, as their person ship, in reply to the
// step, never through the basket; then the step is handled.

const AT = new Date('2026-10-31T21:05:00.000Z');
const STEP_ID = '6f1c2a40-5d1b-4b8e-9a51-0c8e3f2a7d10';
const STEP_OUTCOME = 'application/vnd.aeolus.step-outcome+json';

/** builder-plugin's step, as Charlotte opened it. */
const STEP: OpenedDelivery = {
  fleetId: FLEET_ID,
  shipId: PERSON_SHIP_ID,
  deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0s01',
  messageId: 'msg_01m3tbfspe96yf1rnr4ank0s01',
  senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9plg',
  from: 'builder-plugin',
  title: 'Create the GitHub repository aeolus-fleet-memory-plugin',
  contentType: 'application/vnd.aeolus.step+json',
  askedQuestionId: null,
  withdrawnQuestionId: null,
  stepId: STEP_ID,
  withdrawnStepId: null,
  stepLink: null,
  openedIn: null,
  sentAt: new Date('2026-10-31T20:40:00.000Z'),
  openedAt: AT,
};

/** A text message Charlotte opened: no step. */
const TEXT: OpenedDelivery = { ...STEP, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0t01', messageId: 'msg_01m3tbfspe96yf1rnr4ank0t01', title: 'The build is red', contentType: 'text/plain', stepId: null };

let ship: ReturnType<typeof fakePersonShipDoor>;
let opened: ReturnType<typeof memoryOpenedDeliveries>;
let outcomes: ReturnType<typeof memoryItemOutcomes>;
let doneDelivery: ReturnType<typeof createDoneDelivery>;

beforeEach(async () => {
  const crews = memoryPersonCrews();
  opened = memoryOpenedDeliveries();
  await opened.save(STEP);
  await opened.save(TEXT);
  outcomes = memoryItemOutcomes();
  ship = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries: [] });
  doneDelivery = createDoneDelivery({ crewPersonShip: fakeCrewPersonShip(crews), crews, door: ship.door, opened, changes: memoryInboxChanges(), outcomes, clock: { now: () => AT } });
});

describe('a person marks a step done or that they cannot, with a note', () => {
  it('sends the asker the step outcome done with the note, in reply to the step, then it is handled', async () => {
    const done = await doneDelivery({ caller: CHARLOTTE_GRANT, place: 'bridge', deliveryId: STEP.deliveryId, outcome: 'done', note: 'Created; it is private for now' });

    expect(done).toEqual({ isOk: true, value: { deliveryId: STEP.deliveryId, isHandled: true } });
    expect(ship.replies).toEqual([
      { to: STEP.senderShipId, inReplyTo: STEP.messageId, contentType: STEP_OUTCOME, payload: JSON.stringify({ stepId: STEP_ID, outcome: 'done', note: 'Created; it is private for now' }), idempotencyKey: `step-outcome-${STEP.deliveryId}` },
    ]);
    expect(ship.calls).toEqual([`reply(${STEP.messageId})`, `handled(${STEP.deliveryId})`]);
  });

  it('sends the asker the step outcome cannot with the note, and keeps cannot with the note where the person said it', async () => {
    await doneDelivery({ caller: CHARLOTTE_GRANT, place: 'chat', deliveryId: STEP.deliveryId, outcome: 'cannot', note: 'I have no right to create repositories there' });

    expect({ payloads: ship.replies.map(({ payload }) => payload), kept: outcomes.held.map(({ place, kind, note }) => ({ place, kind, note })) }).toEqual({
      payloads: [JSON.stringify({ stepId: STEP_ID, outcome: 'cannot', note: 'I have no right to create repositories there' })],
      kept: [{ place: 'chat', kind: 'cannot', note: 'I have no right to create repositories there' }],
    });
  });

  it.each([
    { what: 'no note', note: undefined },
    { what: 'an empty note', note: '' },
    { what: 'a note of spaces only', note: '  \n' },
  ])('sends the outcome without a note for $what', async ({ note }) => {
    await doneDelivery({ caller: CHARLOTTE_GRANT, place: 'bridge', deliveryId: STEP.deliveryId, outcome: 'done', note });

    expect(ship.replies.map(({ payload }) => payload)).toEqual([JSON.stringify({ stepId: STEP_ID, outcome: 'done' })]);
  });

  it('marks a step done when no outcome is named, as a chat that only says done', async () => {
    await doneDelivery({ caller: CHARLOTTE_GRANT, place: 'chat', deliveryId: STEP.deliveryId });

    expect(ship.replies.map(({ payload }) => payload)).toEqual([JSON.stringify({ stepId: STEP_ID, outcome: 'done' })]);
  });

  it('says why the fleet refused the outcome, keeping the step to mark again, not handled', async () => {
    ship.refusals.reply.push({ code: 'NOT_REACHABLE', message: 'builder-plugin is retired' });

    await expect(doneDelivery({ caller: CHARLOTTE_GRANT, place: 'bridge', deliveryId: STEP.deliveryId, outcome: 'cannot', note: 'Not mine' })).resolves.toEqual({
      isOk: false,
      error: { kind: 'SEND_REFUSED', message: 'The fleet did not take your outcome: builder-plugin is retired' },
    });
    expect({ calls: ship.calls, isKept: opened.held.size === 2 }).toEqual({ calls: [`reply(${STEP.messageId})`], isKept: true });
  });

  it('sends the same outcome under the same key when the person tries again after the fleet did not take handled, so it is sent once', async () => {
    ship.refusals.handled.push({ code: 'UNAVAILABLE', message: 'The fleet did not answer' });

    await doneDelivery({ caller: CHARLOTTE_GRANT, place: 'bridge', deliveryId: STEP.deliveryId, outcome: 'done', note: 'Done' });
    await expect(doneDelivery({ caller: CHARLOTTE_GRANT, place: 'bridge', deliveryId: STEP.deliveryId, outcome: 'done', note: 'Done' })).resolves.toMatchObject({ isOk: true });
    expect(new Set(ship.replies.map(({ idempotencyKey }) => idempotencyKey))).toEqual(new Set([`step-outcome-${STEP.deliveryId}`]));
  });
});

describe('done with anything but a step', () => {
  it('sends nothing and is handled, done', async () => {
    await doneDelivery({ caller: CHARLOTTE_GRANT, place: 'bridge', deliveryId: TEXT.deliveryId, outcome: 'done' });

    expect({ calls: ship.calls, kept: outcomes.held.map(({ kind }) => kind) }).toEqual({ calls: [`handled(${TEXT.deliveryId})`], kept: ['done'] });
  });

  it.each([
    { what: 'cannot', input: { outcome: 'cannot' as const } },
    { what: 'a note', input: { note: 'Seen it' } },
  ])('refuses $what, sending nothing, as only a step takes one', async ({ input }) => {
    await expect(doneDelivery({ caller: CHARLOTTE_GRANT, place: 'chat', deliveryId: TEXT.deliveryId, ...input })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_A_STEP' } });
    expect(ship.calls).toEqual([]);
  });
});
