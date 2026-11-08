import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aPersonDelivery, CHARLOTTE_GRANT, fakeCrewPersonShip, fakePersonShipDoor, holding, memoryOpenedDeliveries, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { createHeldDeliveries } from './held-deliveries.js';
import type { OpenedDelivery, PersonDelivery } from './ports.js';
import { createCountWaitingOn, createReadWaitingCount } from './read-waiting-count.js';
import { FIXED_CLOCK } from '../../../test/support/fixed-clock.js';

// The count behind the app's Home indicator and icon badge: what waits on the
// person, questions and steps waiting, plus plain messages not yet seen.
// Alerts and notices are left out. It reads what waits and what the person
// opened, never the record.

let crews: ReturnType<typeof memoryPersonCrews>;
let opened: ReturnType<typeof memoryOpenedDeliveries>;

beforeEach(() => {
  crews = memoryPersonCrews();
  opened = memoryOpenedDeliveries();
});

const QUESTION = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001', askedQuestionId: 'q-1' });
const STEP = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', contentType: 'application/vnd.aeolus.step+json', askedQuestionId: null, stepId: 's-1', headline: 'Create the repository' });
const MESSAGE = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0003', contentType: 'text/plain', payload: 'The build is red', headline: null, askedQuestionId: null });
const ALERT = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0004', contentType: 'application/vnd.aeolus.alert+json', askedQuestionId: null });
const NOTICE = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0005', contentType: 'application/vnd.aeolus.notice+json', askedQuestionId: null });
const MEETING_ADDED = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0006', contentType: 'application/vnd.aeolus.meeting.added+json', headline: null, askedQuestionId: null });
const WITHDRAWAL = aPersonDelivery({
  deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0007',
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
    senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9trk',
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
  return { ...ship, readWaitingCount: createReadWaitingCount({ crewPersonShip: fakeCrewPersonShip(crews), crews, door, held, opened }) };
}

describe('a person reads the count of what waits on them', () => {
  it('counts the questions and steps waiting and the plain messages not yet seen', async () => {
    await expect(counting([QUESTION, STEP, MESSAGE]).readWaitingCount(CHARLOTTE_GRANT)).resolves.toEqual({ isOk: true, value: { count: 3 } });
  });

  it('counts no alert, no notice and no meeting notice', async () => {
    await expect(counting([ALERT, NOTICE, MEETING_ADDED, QUESTION]).readWaitingCount(CHARLOTTE_GRANT)).resolves.toEqual({ isOk: true, value: { count: 1 } });
  });

  it('counts a question or step they opened and have not dealt with', async () => {
    await opened.save(anOpened({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0011' }));
    await opened.save(anOpened({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0012', contentType: 'application/vnd.aeolus.step+json', askedQuestionId: null, stepId: 's-9' }));

    await expect(counting([QUESTION]).readWaitingCount(CHARLOTTE_GRANT)).resolves.toEqual({ isOk: true, value: { count: 3 } });
  });

  it('counts no plain message they opened, as they have seen it', async () => {
    await opened.save(anOpened({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0013', contentType: 'text/markdown', askedQuestionId: null }));

    await expect(counting([MESSAGE]).readWaitingCount(CHARLOTTE_GRANT)).resolves.toEqual({ isOk: true, value: { count: 1 } });
  });

  it('counts no alert or notice they opened', async () => {
    await opened.save(anOpened({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0014', contentType: 'application/vnd.aeolus.alert+json', askedQuestionId: null }));
    await opened.save(anOpened({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0015', contentType: 'application/vnd.aeolus.notice+json', askedQuestionId: null }));

    await expect(counting([]).readWaitingCount(CHARLOTTE_GRANT)).resolves.toEqual({ isOk: true, value: { count: 0 } });
  });

  it('counts no question its asker withdrew, nor the withdrawal', async () => {
    await expect(counting([QUESTION, WITHDRAWAL]).readWaitingCount(CHARLOTTE_GRANT)).resolves.toEqual({ isOk: true, value: { count: 0 } });
  });

  it('counts a delivery once when it is both waiting and opened', async () => {
    await opened.save(anOpened({ deliveryId: QUESTION.deliveryId, askedQuestionId: 'q-1' }));

    await expect(counting([QUESTION]).readWaitingCount(CHARLOTTE_GRANT)).resolves.toEqual({ isOk: true, value: { count: 1 } });
  });

  it('counts no plain message contributed to a meeting, for a person read and a wake alike', async () => {
    const contributed = aPersonDelivery({ ...MESSAGE, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0008', meetingId: 'mtg_01m3tbfspe96yf1rnr4ank0001' });
    const { door } = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries: [QUESTION, MESSAGE, contributed] });
    const held = createHeldDeliveries(FIXED_CLOCK);

    const wake = await createCountWaitingOn({ door, held, opened })({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID }, 'aeolus_ct_v1_charlotte');
    const read = await counting([QUESTION, MESSAGE, contributed]).readWaitingCount(CHARLOTTE_GRANT);

    expect({ wake, read }).toEqual({ wake: { isOk: true, value: 2 }, read: { isOk: true, value: { count: 2 } } });
  });

  it('counts no plain message of a retired sender, for a person read and a wake alike, but counts that of a ship awaiting its crew', async () => {
    const fromRetired = aPersonDelivery({ ...MESSAGE, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0016', senderStatus: 'retired' });
    const fromAwaiting = aPersonDelivery({ ...MESSAGE, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0017', senderStatus: 'awaitingCrew' });
    const waiting = [QUESTION, MESSAGE, fromAwaiting, fromRetired];
    const { door } = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries: waiting });

    const wake = await createCountWaitingOn({ door, held: createHeldDeliveries(FIXED_CLOCK), opened })({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID }, 'aeolus_ct_v1_charlotte');
    const read = await counting(waiting).readWaitingCount(CHARLOTTE_GRANT);

    expect({ wake, read }).toEqual({ wake: { isOk: true, value: 3 }, read: { isOk: true, value: { count: 3 } } });
  });

  it('counts a question of a retired sender, which the person can still answer', async () => {
    const fromRetired = aPersonDelivery({ ...QUESTION, senderStatus: 'retired' });

    await expect(counting([fromRetired]).readWaitingCount(CHARLOTTE_GRANT)).resolves.toEqual({ isOk: true, value: { count: 1 } });
  });

  it('asks the fleet only how many wait while none does, and reads no record', async () => {
    const { calls, readWaitingCount } = counting([]);

    await readWaitingCount(CHARLOTTE_GRANT);

    expect(calls).toEqual(['inbox']);
  });

  it('refuses a caller with no person ship', async () => {
    await expect(counting([QUESTION]).readWaitingCount({ fleetId: FLEET_ID, grantId: 'grant-2' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_A_PERSON' } });
  });
});

describe("the gateway counts what waits on a person ship with the crew token it holds, as its wakes say it", () => {
  it('counts as the person reads it: questions and steps waiting and plain messages not yet seen, no alert or notice', async () => {
    const ship = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries: [QUESTION, STEP, MESSAGE, ALERT, NOTICE] });
    const { door, held } = holding(ship.door);

    await expect(createCountWaitingOn({ door, held, opened })({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID }, 'aeolus_ct_v1_charlotte')).resolves.toEqual({ isOk: true, value: 3 });
  });

  it('says what the fleet refused', async () => {
    const ship = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries: [QUESTION] });
    const { door, held } = holding(ship.door);

    await expect(createCountWaitingOn({ door, held, opened })({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID }, 'aeolus_ct_v1_old')).resolves.toEqual({ isOk: false, error: { code: 'UNAUTHORIZED', message: 'The crew token is not valid' } });
  });
});
