import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aPersonDelivery, CHARLOTTE_GRANT, fakeCrewPersonShip, fakePersonShipDoor, holding, memoryOpenedDeliveries, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import type { OpenedDelivery, PersonDelivery } from './ports.js';
import { createReadWaitingAmong } from './read-waiting-among.js';

// The numbers behind the app's chat list rows: for the ships a page shows,
// how many questions and steps from each wait on the person, by the rule of
// the waiting count. It reads what waits and what the person opened, never
// the record.

let crews: ReturnType<typeof memoryPersonCrews>;
let opened: ReturnType<typeof memoryOpenedDeliveries>;

beforeEach(() => {
  crews = memoryPersonCrews();
  opened = memoryOpenedDeliveries();
});

const TRACKER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9trk';
const RELEASER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9rel';
const WATCHER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9wat';

const QUESTION = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001', askedQuestionId: 'q-1' });
const STEP = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', contentType: 'application/vnd.aeolus.step+json', askedQuestionId: null, stepId: 's-1' });
const RELEASER_QUESTION = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0003', senderShipId: RELEASER, senderName: 'releaser', askedQuestionId: 'q-2' });
const MESSAGE = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0004', contentType: 'text/plain', payload: 'The build is red', headline: null, askedQuestionId: null });
const ALERT = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0005', contentType: 'application/vnd.aeolus.alert+json', askedQuestionId: null });
const WITHDRAWAL = aPersonDelivery({
  deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0006',
  contentType: 'application/vnd.aeolus.question-withdrawal+json',
  askedQuestionId: null,
  withdrawnQuestionId: 'q-1',
  sentAt: new Date('2026-10-19T09:00:00.000Z'),
});

function anOpened(overrides: Partial<OpenedDelivery>): OpenedDelivery {
  return {
    fleetId: FLEET_ID,
    shipId: PERSON_SHIP_ID,
    deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0009',
    messageId: 'msg_01m3tbfspe96yf1rnr4ank0009',
    senderShipId: TRACKER,
    from: 'tracker',
    title: 'Go for release 1.4?',
    contentType: 'application/vnd.aeolus.question+json',
    askedQuestionId: 'q-9',
    withdrawnQuestionId: null,
    stepId: null,
    withdrawnStepId: null,
    stepLink: null,
    openedIn: null,
    sentAt: new Date('2026-10-19T07:00:00.000Z'),
    openedAt: new Date('2026-10-19T07:30:00.000Z'),
    ...overrides,
  };
}

function counting(waiting: PersonDelivery[]) {
  const ship = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries: waiting });
  const { door, held } = holding(ship.door);
  return { ...ship, readWaitingAmong: createReadWaitingAmong({ crewPersonShip: fakeCrewPersonShip(crews), crews, door, held, opened }) };
}

describe('a person reads how many questions and steps wait from each of the ships a page shows', () => {
  it('counts the questions and steps waiting from each ship asked', async () => {
    const { readWaitingAmong } = counting([QUESTION, STEP, RELEASER_QUESTION]);

    await expect(readWaitingAmong({ caller: CHARLOTTE_GRANT, shipIds: [TRACKER, RELEASER] })).resolves.toEqual({
      isOk: true,
      value: [
        { shipId: TRACKER, count: 2 },
        { shipId: RELEASER, count: 1 },
      ],
    });
  });

  it('leaves out a ship with nothing waiting and a ship not asked', async () => {
    const { readWaitingAmong } = counting([QUESTION, RELEASER_QUESTION]);

    await expect(readWaitingAmong({ caller: CHARLOTTE_GRANT, shipIds: [TRACKER, WATCHER] })).resolves.toEqual({ isOk: true, value: [{ shipId: TRACKER, count: 1 }] });
  });

  it('counts no plain message, alert or withdrawn question', async () => {
    const { readWaitingAmong } = counting([MESSAGE, ALERT, QUESTION, WITHDRAWAL]);

    await expect(readWaitingAmong({ caller: CHARLOTTE_GRANT, shipIds: [TRACKER] })).resolves.toEqual({ isOk: true, value: [] });
  });

  it('counts a question or step they opened and have not dealt with, once when it also waits', async () => {
    await opened.save(anOpened({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0011' }));
    await opened.save(anOpened({ deliveryId: QUESTION.deliveryId, askedQuestionId: 'q-1' }));

    await expect(counting([QUESTION]).readWaitingAmong({ caller: CHARLOTTE_GRANT, shipIds: [TRACKER] })).resolves.toEqual({ isOk: true, value: [{ shipId: TRACKER, count: 2 }] });
  });

  it('asks the fleet only how many wait while none does, and reads no record', async () => {
    const { calls, readWaitingAmong } = counting([]);

    await readWaitingAmong({ caller: CHARLOTTE_GRANT, shipIds: [TRACKER] });

    expect(calls).toEqual(['inbox']);
  });

  it('refuses a caller with no person ship', async () => {
    await expect(counting([QUESTION]).readWaitingAmong({ caller: { fleetId: FLEET_ID, grantId: 'grant-2' }, shipIds: [TRACKER] })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_A_PERSON' } });
  });
});
