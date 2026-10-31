import type { DeliveryState } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aPersonDelivery, CHARLOTTE_GRANT, fakeCrewPersonShip, fakePersonShipDoor, memoryItemOutcomes, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import type { RecordedPersonDelivery } from './ports.js';
import { createReadRecord, RECORD_PAGE_SIZE } from './read-record.js';

// Bridge reads the person ship's record from core (docs/design/bridge,
// CC12): every delivery, newest first, each with its job, its state and,
// once the person acted on it, what came of it and where (CC4).

let crews: ReturnType<typeof memoryPersonCrews>;
let outcomes: ReturnType<typeof memoryItemOutcomes>;

beforeEach(() => {
  crews = memoryPersonCrews();
  outcomes = memoryItemOutcomes();
});

function aRecorded(id: number, overrides: Partial<RecordedPersonDelivery> = {}): RecordedPersonDelivery {
  const suffix = String(id).padStart(4, '0');
  return { ...aPersonDelivery({ deliveryId: `dlv_01m3tbfspe96yf1rnr4ank${suffix}`, messageId: `msg_01m3tbfspe96yf1rnr4ank${suffix}` }), state: 'pending', isPayloadUnreadable: false, ...overrides };
}

function readRecord(record: RecordedPersonDelivery[]) {
  const ship = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries: [], record });
  return { ...ship, readRecord: createReadRecord({ crewPersonShip: fakeCrewPersonShip(crews), crews, door: ship.door, outcomes }) };
}

describe("a person reads their person ship's record (Bridge, CC12)", () => {
  it('lists each delivery newest first with who sent it, its title, its job and when it was sent', async () => {
    const { readRecord: read } = readRecord([aRecorded(1), aRecorded(2, { contentType: 'application/vnd.aeolus.notice+json', payload: '{"headline":"core 0.42.0 is out","body":""}', headline: 'core 0.42.0 is out', senderName: 'builder-core' })]);

    const page = await read({ caller: CHARLOTTE_GRANT, cursor: null });

    expect(page.isOk ? page.value.items.map(({ deliveryId, from, title, job, sentAt }) => ({ deliveryId, from, title, job, sentAt })) : page).toEqual([
      { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', from: 'builder-core', title: 'core 0.42.0 is out', job: 'stay-aware', sentAt: '2026-10-19T08:00:00.000Z' },
      { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001', from: 'tracker', title: 'Go for release 1.4?', job: 'decide', sentAt: '2026-10-19T08:00:00.000Z' },
    ]);
  });

  it.each<[DeliveryState, string]>([
    ['pending', 'new'],
    ['received', 'new'],
    ['handed', 'new'],
    ['acknowledged', 'seen'],
    ['handled', 'done'],
    ['notHandled', 'done'],
    ['undeliverable', 'done'],
    ['dismissed', 'done'],
    ['abandoned', 'done'],
  ])('shows a delivery %s as %s', async (state, itemState) => {
    const page = await readRecord([aRecorded(1, { state })]).readRecord({ caller: CHARLOTTE_GRANT, cursor: null });

    expect(page.isOk ? page.value.items.map((item) => item.state) : page).toEqual([itemState]);
  });

  it('says what came of an item and where, as the gateway kept it when the person acted', async () => {
    await outcomes.save({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001', place: 'slack', kind: 'answered', option: 2, at: new Date('2026-10-31T19:58:00.000Z') });

    const page = await readRecord([aRecorded(1, { state: 'handled' }), aRecorded(2, { state: 'handled' })]).readRecord({ caller: CHARLOTTE_GRANT, cursor: null });

    expect(page.isOk ? page.value.items.map(({ outcome }) => outcome) : page).toEqual([null, { place: 'slack', kind: 'answered', option: 2, at: '2026-10-31T19:58:00.000Z' }]);
  });

  it("keeps another person ship's outcome out of the record", async () => {
    await outcomes.save({ fleetId: FLEET_ID, shipId: 'shp_01m3tbfspe96yf1rnr4ank0oth', deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001', place: 'bridge', kind: 'seen', option: null, at: new Date('2026-10-31T19:58:00.000Z') });

    const page = await readRecord([aRecorded(1, { state: 'handled' })]).readRecord({ caller: CHARLOTTE_GRANT, cursor: null });

    expect(page.isOk ? page.value.items.map(({ outcome }) => outcome) : page).toEqual([null]);
  });

  it(`reads ${String(RECORD_PAGE_SIZE)} a page, and the next page after the cursor it answered`, async () => {
    const { readRecord: read, calls } = readRecord(Array.from({ length: RECORD_PAGE_SIZE + 1 }, (_, index) => aRecorded(index + 1)));

    const first = await read({ caller: CHARLOTTE_GRANT, cursor: null });
    const next = await read({ caller: CHARLOTTE_GRANT, cursor: first.isOk ? first.value.nextCursor : null });

    expect({
      first: first.isOk ? { size: first.value.items.length, nextCursor: first.value.nextCursor } : first,
      next: next.isOk ? { ids: next.value.items.map(({ deliveryId }) => deliveryId), nextCursor: next.value.nextCursor } : next,
      calls,
    }).toEqual({
      first: { size: 20, nextCursor: 'dlv_01m3tbfspe96yf1rnr4ank0002' },
      next: { ids: ['dlv_01m3tbfspe96yf1rnr4ank0001'], nextCursor: null },
      calls: ['record(newest)', 'record(dlv_01m3tbfspe96yf1rnr4ank0002)'],
    });
  });

  it('titles a sealed message the fleet cannot unseal as sealed, never by its empty payload', async () => {
    const page = await readRecord([aRecorded(1, { contentType: 'text/plain', payload: '', headline: null, isPayloadUnreadable: true })]).readRecord({ caller: CHARLOTTE_GRANT, cursor: null });

    expect(page.isOk ? page.value.items.map(({ title }) => title) : page).toEqual(['A sealed message: the fleet cannot unseal it now']);
  });

  it('says the record cannot be read now when the fleet does not answer, so nothing is lost', async () => {
    const reading = readRecord([aRecorded(1)]);
    reading.refusals.record.push({ code: 'FLEET_UNREACHABLE', message: 'The fleet did not answer' });

    await expect(reading.readRecord({ caller: CHARLOTTE_GRANT, cursor: null })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });
});
