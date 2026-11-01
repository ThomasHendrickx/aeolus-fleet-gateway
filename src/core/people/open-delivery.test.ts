import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { CHARLOTTE_GRANT, aPersonDelivery, fakeCrewPersonShip, fakePersonShipDoor, memoryInboxChanges, memoryItemOutcomes, memoryOpenedDeliveries, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import type { PersonDelivery } from './ports.js';
import { createOpenDelivery } from './open-delivery.js';

// A person opens one delivery of their person ship's inbox from their MCP client:
// their own act, so the gateway acknowledges it for them (Q20, interop 5.1).

const AT = new Date('2026-10-19T09:00:00.000Z');
const QUESTION = aPersonDelivery();
const NOTE = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', messageId: 'msg_01m3tbfspe96yf1rnr4ank0002', contentType: 'text/plain', payload: 'The build is red', headline: null });


let crews: ReturnType<typeof memoryPersonCrews>;
let opened: ReturnType<typeof memoryOpenedDeliveries>;
let changes: ReturnType<typeof memoryInboxChanges>;
let outcomes: ReturnType<typeof memoryItemOutcomes>;

beforeEach(() => {
  crews = memoryPersonCrews();
  opened = memoryOpenedDeliveries();
  changes = memoryInboxChanges();
  outcomes = memoryItemOutcomes();
});

function opening(deliveries: PersonDelivery[]) {
  const ship = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries });
  return { ...ship, openDelivery: createOpenDelivery({ crewPersonShip: fakeCrewPersonShip(crews), crews, door: ship.door, opened, changes, outcomes, clock: { now: () => AT } }) };
}

const CALLER = CHARLOTTE_GRANT;

describe('a person opens a delivery that waits for their person ship', () => {
  it('shows it whole: who sent it, when, its title, content type and payload', async () => {
    const { openDelivery } = opening([NOTE, QUESTION]);

    await expect(openDelivery({ caller: CALLER, deliveryId: QUESTION.deliveryId, place: 'chat' })).resolves.toEqual({
      isOk: true,
      value: { deliveryId: QUESTION.deliveryId, from: 'tracker', title: 'Go for release 1.4?', sentAt: '2026-10-19T08:00:00.000Z', contentType: QUESTION.contentType, payload: QUESTION.payload, meetingId: null, stale: null },
    });
  });

  it('says the meeting a contribution was made to, so the person goes on to it', async () => {
    const contribution = aPersonDelivery({ ...NOTE, payload: 'Marketing is on track', meetingId: 'mtg_01m5qa5j85mgd4z61d9c2k4mtg' });
    const { openDelivery } = opening([contribution]);

    await expect(openDelivery({ caller: CALLER, deliveryId: contribution.deliveryId, place: 'chat' })).resolves.toMatchObject({ isOk: true, value: { meetingId: 'mtg_01m5qa5j85mgd4z61d9c2k4mtg' } });
  });

  it('acknowledges it for the person, once it kept what an answer and the inbox need: its message, its sender, title, content type, the question it asks and when it was sent, never its payload', async () => {
    const { openDelivery, calls } = opening([QUESTION]);

    await openDelivery({ caller: CALLER, deliveryId: QUESTION.deliveryId, place: 'chat' });

    expect(calls).toEqual(['inbox', 'pushReceive(10)', `ack(${QUESTION.deliveryId})`]);
    expect([...opened.held.values()]).toEqual([
      {
        fleetId: FLEET_ID,
        shipId: PERSON_SHIP_ID,
        deliveryId: QUESTION.deliveryId,
        messageId: QUESTION.messageId,
        senderShipId: QUESTION.senderShipId,
        from: 'tracker',
        title: 'Go for release 1.4?',
        contentType: 'application/vnd.aeolus.question+json',
        askedQuestionId: '9b2f',
        withdrawnQuestionId: null,
        stepId: null,
        withdrawnStepId: null,
        sentAt: QUESTION.sentAt,
        openedAt: AT,
      },
    ]);
  });

  it('keeps the uuid of the step a step asks, so its outcome names it (Bridge, CC14)', async () => {
    const step = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0s01', contentType: 'application/vnd.aeolus.step+json', payload: '{}', headline: 'Sign in to linear', askedQuestionId: null, stepId: '6f1c2a40-5d1b-4b8e-9a51-0c8e3f2a7d10' });
    const { openDelivery } = opening([step]);

    await openDelivery({ caller: CALLER, deliveryId: step.deliveryId, place: 'bridge' });

    expect([...opened.held.values()].map(({ stepId }) => stepId)).toEqual(['6f1c2a40-5d1b-4b8e-9a51-0c8e3f2a7d10']);
  });

  it('refuses a delivery that does not wait for the person, acknowledging nothing', async () => {
    const { openDelivery, calls } = opening([NOTE]);

    await expect(openDelivery({ caller: CALLER, deliveryId: QUESTION.deliveryId, place: 'chat' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_DELIVERY' } });
    expect({ calls, opened: opened.held.size }).toEqual({ calls: ['inbox', 'pushReceive(10)'], opened: 0 });
  });

  it('refuses at once while nothing waits', async () => {
    const { openDelivery, calls } = opening([]);

    await expect(openDelivery({ caller: CALLER, deliveryId: QUESTION.deliveryId, place: 'chat' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_DELIVERY' } });
    expect(calls).toEqual(['inbox']);
  });

  it('refuses an account with no person ship, asking the fleet nothing', async () => {
    const { openDelivery, calls } = opening([QUESTION]);

    await expect(openDelivery({ caller: { fleetId: FLEET_ID, grantId: 'grant-2' }, deliveryId: QUESTION.deliveryId, place: 'chat' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_A_PERSON' } });
    expect(calls).toEqual([]);
  });

  it('says the fleet did not answer when it refuses the acknowledgement, keeping what it opened so a second open goes on', async () => {
    const ship = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries: [QUESTION] });
    const door = { ...ship.door, ack: () => Promise.resolve({ isOk: false as const, error: { code: 'UNAVAILABLE', message: 'The fleet did not answer' } }) };
    const openDelivery = createOpenDelivery({ crewPersonShip: fakeCrewPersonShip(crews), crews, door, opened, changes, outcomes, clock: { now: () => AT } });

    await expect(openDelivery({ caller: CALLER, deliveryId: QUESTION.deliveryId, place: 'chat' })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
    expect(opened.held.size).toBe(1);
  });

  it("tells the person's pages their inbox changed once it acknowledged it (wake a person, #1014)", async () => {
    const { openDelivery } = opening([QUESTION]);

    await openDelivery({ caller: CALLER, deliveryId: QUESTION.deliveryId, place: 'chat' });

    expect(changes.told).toEqual([{ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID }]);
  });

  it('tells nothing when the fleet refused the acknowledgement', async () => {
    const ship = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries: [QUESTION] });
    const door = { ...ship.door, ack: () => Promise.resolve({ isOk: false as const, error: { code: 'UNAVAILABLE', message: 'The fleet did not answer' } }) };
    const openDelivery = createOpenDelivery({ crewPersonShip: fakeCrewPersonShip(crews), crews, door, opened, changes, outcomes, clock: { now: () => AT } });

    await openDelivery({ caller: CALLER, deliveryId: QUESTION.deliveryId, place: 'chat' });

    expect(changes.told).toEqual([]);
  });
});

describe('a person opens a delivery of a sealed fleet whose company key is not reachable (decision 0068)', () => {
  const KEY_UNAVAILABLE = { code: 'KEY_UNAVAILABLE', message: "The fleet's company key is not reachable: access denied" };

  it('says the message is sealed and the key not reachable, acknowledging nothing and keeping the crew', async () => {
    const { openDelivery, calls, refusals } = opening([QUESTION]);
    refusals.pushReceive.push(KEY_UNAVAILABLE);

    await expect(openDelivery({ caller: CALLER, deliveryId: QUESTION.deliveryId, place: 'chat' })).resolves.toEqual({
      isOk: false,
      error: { kind: 'KEY_UNAVAILABLE', message: "The message is sealed and the fleet's company key is not reachable: try again later. Nothing is lost; it waits." },
    });
    expect({ calls, crew: crews.held.length, opened: opened.held.size }).toEqual({ calls: ['inbox', 'pushReceive(10)'], crew: 1, opened: 0 });
  });

  it('says so too when it opens again a delivery it opened before', async () => {
    const { openDelivery, refusals } = opening([QUESTION]);
    await openDelivery({ caller: CALLER, deliveryId: QUESTION.deliveryId, place: 'chat' });
    refusals.delivery.push(KEY_UNAVAILABLE);

    await expect(openDelivery({ caller: CALLER, deliveryId: QUESTION.deliveryId, place: 'chat' })).resolves.toMatchObject({ isOk: false, error: { kind: 'KEY_UNAVAILABLE' } });
  });
});

describe('a person opens again a delivery they opened, from any client (aeolus-fleet #1046)', () => {
  it('shows it whole again, as the fleet reads it again, acknowledging it once only', async () => {
    const { openDelivery, calls } = opening([QUESTION]);
    const first = await openDelivery({ caller: CALLER, deliveryId: QUESTION.deliveryId, place: 'chat' });

    const again = await openDelivery({ caller: CALLER, deliveryId: QUESTION.deliveryId, place: 'chat' });

    expect({ again, isSame: JSON.stringify(again) === JSON.stringify(first) }).toEqual({
      again: {
        isOk: true,
        value: { deliveryId: QUESTION.deliveryId, from: 'tracker', title: 'Go for release 1.4?', sentAt: '2026-10-19T08:00:00.000Z', contentType: QUESTION.contentType, payload: QUESTION.payload, meetingId: null, stale: null },
      },
      isSame: true,
    });
    expect(calls.filter((call) => call.startsWith('ack'))).toEqual([`ack(${QUESTION.deliveryId})`]);
  });

  it('says again the meeting a contribution was made to, so the person can go back to it', async () => {
    const contribution = aPersonDelivery({ ...NOTE, payload: 'Marketing is on track', meetingId: 'mtg_01m5qa5j85mgd4z61d9c2k4mtg' });
    const { openDelivery } = opening([contribution]);
    await openDelivery({ caller: CALLER, deliveryId: contribution.deliveryId, place: 'chat' });

    await expect(openDelivery({ caller: CALLER, deliveryId: contribution.deliveryId, place: 'chat' })).resolves.toMatchObject({ isOk: true, value: { meetingId: 'mtg_01m5qa5j85mgd4z61d9c2k4mtg' } });
  });

  it('keeps no payload of it: the second open reads it from the fleet', async () => {
    const { openDelivery, calls } = opening([QUESTION]);
    await openDelivery({ caller: CALLER, deliveryId: QUESTION.deliveryId, place: 'chat' });

    await openDelivery({ caller: CALLER, deliveryId: QUESTION.deliveryId, place: 'chat' });

    expect({ isPayloadKept: JSON.stringify([...opened.held.values()]).includes('All checks are green'), lastCall: calls.at(-1) }).toEqual({ isPayloadKept: false, lastCall: `delivery(${QUESTION.deliveryId})` });
  });

  it('says why when the fleet no longer holds it opened', async () => {
    const { openDelivery, refusals } = opening([QUESTION]);
    await openDelivery({ caller: CALLER, deliveryId: QUESTION.deliveryId, place: 'chat' });
    refusals.delivery.push({ code: 'DELIVERY_NOT_ACKNOWLEDGED', message: `Delivery ${QUESTION.deliveryId} is handled, not acknowledged` });

    await expect(openDelivery({ caller: CALLER, deliveryId: QUESTION.deliveryId, place: 'chat' })).resolves.toEqual({
      isOk: false,
      error: { kind: 'NO_SUCH_DELIVERY', message: `The fleet no longer holds it opened: Delivery ${QUESTION.deliveryId} is handled, not acknowledged` },
    });
  });
});

describe('a person sees an alert or a notice: seeing it is all it asks (Bridge, CC16)', () => {
  const ALERT = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0003', messageId: 'msg_01m3tbfspe96yf1rnr4ank0003', senderName: 'watch', contentType: 'application/vnd.aeolus.alert+json', payload: '{}', headline: 'builder-gateway: no report change for 2 h' });

  it('acknowledges it and reports it handled at once, keeping nothing opened', async () => {
    const { openDelivery, calls } = opening([ALERT]);

    await openDelivery({ caller: CALLER, deliveryId: ALERT.deliveryId, place: 'bridge' });

    expect({ calls: calls.filter((call) => call !== 'inbox' && !call.startsWith('pushReceive')), opened: [...opened.held.values()] }).toEqual({ calls: [`ack(${ALERT.deliveryId})`, `handled(${ALERT.deliveryId})`], opened: [] });
  });

  it('keeps it seen in the place the person saw it', async () => {
    await opening([ALERT]).openDelivery({ caller: CALLER, deliveryId: ALERT.deliveryId, place: 'bridge' });

    expect(outcomes.held).toEqual([{ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, deliveryId: ALERT.deliveryId, place: 'bridge', kind: 'seen', option: null, at: AT }]);
  });

  it('keeps nothing of a question opened: it still waits on the person', async () => {
    await opening([QUESTION]).openDelivery({ caller: CALLER, deliveryId: QUESTION.deliveryId, place: 'bridge' });

    expect(outcomes.held).toEqual([]);
  });
});

describe('a person opens a question its asker withdrew or replaced: their look at it is all it asks (Bridge, section 9)', () => {
  const ASKED = '9b2f6c1e-4a7d-4e0b-8c3f-2d5a6b7c8d9e';
  const ASKING = aPersonDelivery({ askedQuestionId: ASKED });
  const WITHDRAWAL = aPersonDelivery({
    deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0006',
    messageId: 'msg_01m3tbfspe96yf1rnr4ank0006',
    contentType: 'application/vnd.aeolus.question-withdrawal+json',
    payload: JSON.stringify({ questionId: ASKED }),
    headline: null,
    askedQuestionId: null,
    withdrawnQuestionId: ASKED,
  });
  const REPLACEMENT = aPersonDelivery({
    deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0007',
    messageId: 'msg_01m3tbfspe96yf1rnr4ank0007',
    contentType: 'application/vnd.aeolus.question-replacement+json',
    headline: 'Go for release 1.4 after #1488?',
    askedQuestionId: '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f',
    withdrawnQuestionId: ASKED,
  });

  function asked(calls: string[]): string[] {
    return calls.filter((call) => call !== 'inbox' && !call.startsWith('pushReceive'));
  }

  it('shows a withdrawn question stale, with nothing to answer', async () => {
    const shown = await opening([ASKING, WITHDRAWAL]).openDelivery({ caller: CALLER, deliveryId: ASKING.deliveryId, place: 'bridge' });

    expect(shown).toMatchObject({ isOk: true, value: { deliveryId: ASKING.deliveryId, stale: { kind: 'withdrawn', replacementId: null } } });
  });

  it('acknowledges and reports handled both the withdrawn question and its withdrawal, keeping nothing opened', async () => {
    const { openDelivery, calls } = opening([ASKING, WITHDRAWAL]);

    await openDelivery({ caller: CALLER, deliveryId: ASKING.deliveryId, place: 'bridge' });

    expect({ calls: asked(calls), opened: [...opened.held.values()] }).toEqual({
      calls: [`ack(${ASKING.deliveryId})`, `handled(${ASKING.deliveryId})`, `ack(${WITHDRAWAL.deliveryId})`, `handled(${WITHDRAWAL.deliveryId})`],
      opened: [],
    });
  });

  it('keeps the question withdrawn and its withdrawal seen, where the person looked at it', async () => {
    await opening([ASKING, WITHDRAWAL]).openDelivery({ caller: CALLER, deliveryId: ASKING.deliveryId, place: 'chat' });

    expect(outcomes.held).toEqual([
      { fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, deliveryId: ASKING.deliveryId, place: 'chat', kind: 'withdrawn', option: null, at: AT },
      { fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, deliveryId: WITHDRAWAL.deliveryId, place: 'chat', kind: 'seen', option: null, at: AT },
    ]);
  });

  it('is done with a question the person opened before, once it was withdrawn, at their next look', async () => {
    const ship = { crewToken: 'aeolus_ct_v1_charlotte', deliveries: [ASKING] };
    const fleet = fakePersonShipDoor(ship);
    const openDelivery = createOpenDelivery({ crewPersonShip: fakeCrewPersonShip(crews), crews, door: fleet.door, opened, changes, outcomes, clock: { now: () => AT } });
    await openDelivery({ caller: CALLER, deliveryId: ASKING.deliveryId, place: 'bridge' });
    ship.deliveries.push(WITHDRAWAL);

    const shown = await openDelivery({ caller: CALLER, deliveryId: ASKING.deliveryId, place: 'bridge' });

    expect({ stale: shown.isOk ? shown.value.stale : shown, calls: asked(fleet.calls), opened: [...opened.held.values()] }).toEqual({
      stale: { kind: 'withdrawn', replacementId: null },
      calls: [`ack(${ASKING.deliveryId})`, `delivery(${ASKING.deliveryId})`, `handled(${ASKING.deliveryId})`, `ack(${WITHDRAWAL.deliveryId})`, `handled(${WITHDRAWAL.deliveryId})`],
      opened: [],
    });
  });

  it('shows a replaced question stale, linked to its replacement, and is done with it alone: the replacement is a new item that still waits', async () => {
    const { openDelivery, calls } = opening([ASKING, REPLACEMENT]);

    const shown = await openDelivery({ caller: CALLER, deliveryId: ASKING.deliveryId, place: 'bridge' });

    expect({ stale: shown.isOk ? shown.value.stale : shown, calls: asked(calls), kinds: outcomes.held.map(({ deliveryId, kind }) => ({ deliveryId, kind })) }).toEqual({
      stale: { kind: 'replaced', replacementId: REPLACEMENT.deliveryId },
      calls: [`ack(${ASKING.deliveryId})`, `handled(${ASKING.deliveryId})`],
      kinds: [{ deliveryId: ASKING.deliveryId, kind: 'replaced' }],
    });
  });

  it('is done with the question a replacement replaces once the person opens the replacement, which still waits on them', async () => {
    const { openDelivery, calls } = opening([ASKING, REPLACEMENT]);

    const shown = await openDelivery({ caller: CALLER, deliveryId: REPLACEMENT.deliveryId, place: 'bridge' });

    expect({ stale: shown.isOk ? shown.value.stale : shown, calls: asked(calls), kinds: outcomes.held.map(({ deliveryId, kind }) => ({ deliveryId, kind })), opened: [...opened.held.keys()] }).toEqual({
      stale: null,
      calls: [`ack(${REPLACEMENT.deliveryId})`, `ack(${ASKING.deliveryId})`, `handled(${ASKING.deliveryId})`],
      kinds: [{ deliveryId: ASKING.deliveryId, kind: 'replaced' }],
      opened: [`${FLEET_ID}/${PERSON_SHIP_ID}/${REPLACEMENT.deliveryId}`],
    });
  });
});

describe('a person opens a step its asker withdrew or replaced: as a question, their look at it is all it asks (Bridge, CC14)', () => {
  const STEP_ID = '6f1c2a40-5d1b-4b8e-9a51-0c8e3f2a7d10';
  const ASKING = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0s01', messageId: 'msg_01m3tbfspe96yf1rnr4ank0s01', contentType: 'application/vnd.aeolus.step+json', payload: '{}', headline: 'Sign in to linear', askedQuestionId: null, stepId: STEP_ID });
  const WITHDRAWAL = aPersonDelivery({
    deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0006',
    messageId: 'msg_01m3tbfspe96yf1rnr4ank0006',
    contentType: 'application/vnd.aeolus.step-withdrawal+json',
    payload: JSON.stringify({ stepId: STEP_ID }),
    headline: null,
    askedQuestionId: null,
    withdrawnStepId: STEP_ID,
  });
  const REPLACEMENT = aPersonDelivery({
    deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0007',
    messageId: 'msg_01m3tbfspe96yf1rnr4ank0007',
    contentType: 'application/vnd.aeolus.step-replacement+json',
    headline: 'Sign in to linear with the team account',
    askedQuestionId: null,
    stepId: '7a2d3b51-6e2c-4c9f-8b62-1d9f4a3b8e21',
    withdrawnStepId: STEP_ID,
  });

  function asked(calls: string[]): string[] {
    return calls.filter((call) => call !== 'inbox' && !call.startsWith('pushReceive'));
  }

  it('shows a withdrawn step stale, with nothing to do, and is done with it and its withdrawal', async () => {
    const { openDelivery, calls } = opening([ASKING, WITHDRAWAL]);

    const shown = await openDelivery({ caller: CALLER, deliveryId: ASKING.deliveryId, place: 'bridge' });

    expect({ stale: shown.isOk ? shown.value.stale : shown, calls: asked(calls), kinds: outcomes.held.map(({ deliveryId, kind }) => ({ deliveryId, kind })), opened: [...opened.held.values()] }).toEqual({
      stale: { kind: 'withdrawn', replacementId: null },
      calls: [`ack(${ASKING.deliveryId})`, `handled(${ASKING.deliveryId})`, `ack(${WITHDRAWAL.deliveryId})`, `handled(${WITHDRAWAL.deliveryId})`],
      kinds: [
        { deliveryId: ASKING.deliveryId, kind: 'withdrawn' },
        { deliveryId: WITHDRAWAL.deliveryId, kind: 'seen' },
      ],
      opened: [],
    });
  });

  it('shows a replaced step stale, linked to its replacement, and is done with it alone: the replacement is a new item that still waits', async () => {
    const { openDelivery, calls } = opening([ASKING, REPLACEMENT]);

    const shown = await openDelivery({ caller: CALLER, deliveryId: ASKING.deliveryId, place: 'bridge' });

    expect({ stale: shown.isOk ? shown.value.stale : shown, calls: asked(calls), kinds: outcomes.held.map(({ deliveryId, kind }) => ({ deliveryId, kind })) }).toEqual({
      stale: { kind: 'replaced', replacementId: REPLACEMENT.deliveryId },
      calls: [`ack(${ASKING.deliveryId})`, `handled(${ASKING.deliveryId})`],
      kinds: [{ deliveryId: ASKING.deliveryId, kind: 'replaced' }],
    });
  });

  it('is done with the step a replacement replaces once the person opens the replacement, which still waits on them', async () => {
    const { openDelivery, calls } = opening([ASKING, REPLACEMENT]);

    const shown = await openDelivery({ caller: CALLER, deliveryId: REPLACEMENT.deliveryId, place: 'bridge' });

    expect({ stale: shown.isOk ? shown.value.stale : shown, calls: asked(calls), kinds: outcomes.held.map(({ deliveryId, kind }) => ({ deliveryId, kind })), opened: [...opened.held.keys()] }).toEqual({
      stale: null,
      calls: [`ack(${REPLACEMENT.deliveryId})`, `ack(${ASKING.deliveryId})`, `handled(${ASKING.deliveryId})`],
      kinds: [{ deliveryId: ASKING.deliveryId, kind: 'replaced' }],
      opened: [`${FLEET_ID}/${PERSON_SHIP_ID}/${REPLACEMENT.deliveryId}`],
    });
  });
});
