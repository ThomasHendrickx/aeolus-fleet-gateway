import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aPersonDelivery, CHARLOTTE_GRANT, fakeCrewPersonShip, fakePersonShipDoor, holding, memoryOpenedDeliveries, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import type { OpenedDelivery, PersonDelivery } from './ports.js';
import { createReadInboxState } from './read-inbox-state.js';

// Every answer of a person's tools carries the state of their inbox beside
// it (gateway #256, design Q3): counts only, from one core call, so reading
// it confirms no delivery.

let crews: ReturnType<typeof memoryPersonCrews>;
let opened: ReturnType<typeof memoryOpenedDeliveries>;

beforeEach(() => {
  crews = memoryPersonCrews();
  opened = memoryOpenedDeliveries();
});

const OPENED: OpenedDelivery = {
  fleetId: FLEET_ID,
  shipId: PERSON_SHIP_ID,
  deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0009',
  messageId: 'msg_01m3tbfspe96yf1rnr4ank0009',
  senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9trk',
  from: 'tracker',
  title: 'The build is red',
  contentType: 'text/plain',
  askedQuestionId: null,
  withdrawnQuestionId: null,
  stepId: null,
  withdrawnStepId: null,
  stepLink: null,
  openedIn: null,
  sentAt: new Date('2026-10-19T07:00:00.000Z'),
  openedAt: new Date('2026-10-19T07:30:00.000Z'),
};

function somePersonDeliveries(waiting: number): PersonDelivery[] {
  return Array.from({ length: waiting }, (_, index) => aPersonDelivery({ deliveryId: `dlv_01m3tbfspe96yf1rnr4ank000${String(index + 1)}` }));
}

function readInboxState(waiting: number | PersonDelivery[]) {
  const deliveries = typeof waiting === 'number' ? somePersonDeliveries(waiting) : waiting;
  const ship = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries });
  return { ...ship, readInboxState: createReadInboxState({ crewPersonShip: fakeCrewPersonShip(crews), crews, ...holding(ship.door), opened }) };
}

const MEETING_ADDED = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0021', contentType: 'application/vnd.aeolus.meeting.added+json', payload: '{"meetingId":"mtg_01m5qa5j85mgd4z61d9c2k4mtg"}', headline: null, askedQuestionId: null });

describe("the state of a person's inbox, beside every answer of their tools", () => {
  it('counts how many deliveries wait and how many are opened and not dealt with', async () => {
    await opened.save(OPENED);

    await expect(readInboxState(2).readInboxState(CHARLOTTE_GRANT)).resolves.toEqual({ isOk: true, value: { waiting: 2, opened: 1 } });
  });

  it('counts none of either for an empty inbox', async () => {
    await expect(readInboxState(0).readInboxState(CHARLOTTE_GRANT)).resolves.toEqual({ isOk: true, value: { waiting: 0, opened: 0 } });
  });

  it('asks the fleet only how many wait while none does, taking no delivery', async () => {
    const { calls, readInboxState: read } = readInboxState(0);

    await read(CHARLOTTE_GRANT);

    expect(calls).toEqual(['inbox']);
  });

  it('counts no meeting notice, as aeolus_inbox lists none: not waiting and not opened', async () => {
    await opened.save({ ...OPENED, contentType: 'application/vnd.aeolus.meeting.mic+json' });

    await expect(readInboxState([...somePersonDeliveries(2), MEETING_ADDED]).readInboxState(CHARLOTTE_GRANT)).resolves.toEqual({ isOk: true, value: { waiting: 2, opened: 0 } });
  });

  it('refuses a caller with no person ship', async () => {
    await expect(readInboxState(1).readInboxState({ fleetId: FLEET_ID, grantId: 'grant-2' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_A_PERSON' } });
  });
});
