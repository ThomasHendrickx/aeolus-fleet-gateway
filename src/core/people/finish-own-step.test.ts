import type { DeliveryId, DeliveryState, MessageId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, memoryConnectionStore, SHIP_ID } from '../../../test/support/fleet-fakes.js';
import { aPersonDelivery, fakePersonShipDoor, memoryInboxChanges, memoryItemOutcomes, memoryOpenedDeliveries, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import type { SentMessages } from '../mcp-in/ports.js';
import { err, ok } from '../shared/result.js';
import { createFinishOwnStep } from './finish-own-step.js';
import type { OpenedDelivery } from './ports.js';

// The gateway's own asks (Bridge, CC14): a step its ship sent a person, to
// sign in to an outside server, is done when the gateway sees it complete,
// with no press. As the person ship's crew it acknowledges the step if the
// person had not opened it, reports it handled, and keeps it done by the
// gateway.

const AT = new Date('2026-10-31T21:20:00.000Z');
const STEP_MESSAGE_ID: MessageId = 'msg_01m3tbfspe96yf1rnr4ank0stp';
const STEP_DELIVERY_ID: DeliveryId = 'dlv_01m3tbfspe96yf1rnr4ank0stp';

/** The gateway's step, as the person ship's push receive hands it. */
const STEP = aPersonDelivery({
  deliveryId: STEP_DELIVERY_ID,
  messageId: STEP_MESSAGE_ID,
  senderShipId: SHIP_ID,
  senderName: 'gateway',
  contentType: 'application/vnd.aeolus.step+json',
  payload: '{}',
  headline: 'Sign in to attio',
  askedQuestionId: null,
  stepId: '6f1c2a40-5d1b-4b8e-9a51-0c8e3f2a7d11',
  withdrawnStepId: null,
});

/** The same step, as Charlotte opened it before she signed in. */
const OPENED: OpenedDelivery = {
  fleetId: FLEET_ID,
  shipId: PERSON_SHIP_ID,
  deliveryId: STEP_DELIVERY_ID,
  messageId: STEP_MESSAGE_ID,
  senderShipId: SHIP_ID,
  from: 'gateway',
  title: 'Sign in to attio',
  contentType: 'application/vnd.aeolus.step+json',
  askedQuestionId: null,
  withdrawnQuestionId: null,
  stepId: '6f1c2a40-5d1b-4b8e-9a51-0c8e3f2a7d11',
  withdrawnStepId: null,
  sentAt: new Date('2026-10-31T21:00:00.000Z'),
  openedAt: new Date('2026-10-31T21:10:00.000Z'),
};

let state: DeliveryState;
let crews: ReturnType<typeof memoryPersonCrews>;
let ship: ReturnType<typeof fakePersonShipDoor>;
let opened: ReturnType<typeof memoryOpenedDeliveries>;
let outcomes: ReturnType<typeof memoryItemOutcomes>;
let changes: ReturnType<typeof memoryInboxChanges>;
let finish: ReturnType<typeof createFinishOwnStep>;

beforeEach(async () => {
  state = 'received';
  const connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: new Date('2026-10-25T09:00:00.000Z') });
  crews = memoryPersonCrews();
  await crews.save({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, crewToken: 'aeolus_ct_v1_charlotte', crewedAt: new Date('2026-10-31T09:00:00.000Z') });
  ship = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries: [STEP] });
  opened = memoryOpenedDeliveries();
  outcomes = memoryItemOutcomes();
  changes = memoryInboxChanges();
  /** Where the step's delivery stands, as the gateway's ship reads it with sentMessage. */
  const sent: SentMessages = {
    sentMessage: (crewToken, messageId) =>
      Promise.resolve(crewToken === 'aeolus_ct_v1_gateway' && messageId === STEP_MESSAGE_ID ? ok({ deliveryId: STEP_DELIVERY_ID, state, since: AT }) : err({ code: 'NOT_FOUND', message: `No message ${messageId}` })),
  };
  finish = createFinishOwnStep({ connections, sent, crews, door: ship.door, opened, outcomes, changes, clock: { now: () => AT } });
});

const finishCharlottes = () => finish({ fleetId: FLEET_ID, personShipId: PERSON_SHIP_ID, stepMessageId: STEP_MESSAGE_ID });

describe('a step the gateway sees complete is done with no press (Bridge, CC14)', () => {
  it.each([{ state: 'received' as const }, { state: 'handed' as const }])('acknowledges a step $state to the person ship, reports it handled and keeps it done by the gateway', async (given) => {
    state = given.state;

    await finishCharlottes();

    expect({ calls: ship.calls, kept: outcomes.held }).toEqual({
      calls: [`ack(${STEP_DELIVERY_ID})`, `handled(${STEP_DELIVERY_ID})`],
      kept: [{ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, deliveryId: STEP_DELIVERY_ID, place: 'gateway', kind: 'done', option: null, at: AT }],
    });
  });

  it('reports a step the person opened handled, and forgets it opened, so no client of theirs lists it', async () => {
    state = 'acknowledged';
    await opened.save(OPENED);

    await finishCharlottes();

    expect({ calls: ship.calls, opened: opened.held.size }).toEqual({ calls: [`handled(${STEP_DELIVERY_ID})`], opened: 0 });
  });

  it('takes a step still pending first, then acknowledges it and reports it handled', async () => {
    state = 'pending';

    await finishCharlottes();

    expect(ship.calls).toEqual(['pushReceive(10)', `ack(${STEP_DELIVERY_ID})`, `handled(${STEP_DELIVERY_ID})`]);
  });

  it("tells the person's pages their inbox changed", async () => {
    await finishCharlottes();

    expect(changes.told).toEqual([{ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID }]);
  });

  it.each([{ state: 'handled' as const }, { state: 'notHandled' as const }])('changes nothing of a step $state already, as one the person marked first', async (given) => {
    state = given.state;

    await finishCharlottes();

    expect({ calls: ship.calls, kept: outcomes.held }).toEqual({ calls: [], kept: [] });
  });

  it('keeps nothing while the fleet did not take handled, so the step still waits for the person', async () => {
    ship.refusals.handled.push({ code: 'UNAVAILABLE', message: 'The fleet did not answer' });

    await finishCharlottes();

    expect({ kept: outcomes.held, told: changes.told }).toEqual({ kept: [], told: [] });
  });

  it('changes nothing while the gateway crews no ship of the person', async () => {
    await crews.drop(FLEET_ID, PERSON_SHIP_ID);

    await finishCharlottes();

    expect(ship.calls).toEqual([]);
  });
});
