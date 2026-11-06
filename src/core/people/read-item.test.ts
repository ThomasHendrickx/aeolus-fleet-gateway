import { beforeEach, describe, expect, it } from 'vitest';

import { CHARLOTTE_GRANT, aPersonDelivery, fakeCrewPersonShip, fakePersonShipDoor, holding, memoryOpenedDeliveries, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import type { PersonDelivery, RecordedPersonDelivery } from './ports.js';
import { createReadItem } from './read-item.js';

// A person's client shows one item whole by its delivery id, in any state,
// without acknowledging it: what opening returns, minus the acknowledging.

const WAITING = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', messageId: 'msg_01m3tbfspe96yf1rnr4ank0002', contentType: 'text/plain', payload: 'The build is red', headline: null });
const DONE: RecordedPersonDelivery = { ...aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001', messageId: 'msg_01m3tbfspe96yf1rnr4ank0001', contentType: 'text/plain', payload: 'Release 1.4 is out', headline: null }), state: 'handled', isPayloadUnreadable: false };

let crews: ReturnType<typeof memoryPersonCrews>;
let opened: ReturnType<typeof memoryOpenedDeliveries>;

beforeEach(() => {
  crews = memoryPersonCrews();
  opened = memoryOpenedDeliveries();
});

function reading(ship: { deliveries?: PersonDelivery[]; acknowledged?: PersonDelivery[]; record?: RecordedPersonDelivery[] }) {
  const fleet = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries: [], ...ship });
  return { ...fleet, readItem: createReadItem({ crewPersonShip: fakeCrewPersonShip(crews), crews, ...holding(fleet.door), opened }) };
}

describe('a person reads one item whole', () => {
  it('shows a waiting item whole, with its payload and content type, and leaves it unacknowledged', async () => {
    const { readItem, calls } = reading({ deliveries: [WAITING] });

    await expect(readItem({ caller: CHARLOTTE_GRANT, deliveryId: WAITING.deliveryId })).resolves.toEqual({
      isOk: true,
      value: { deliveryId: WAITING.deliveryId, from: 'tracker', title: 'The build is red', sentAt: '2026-10-19T08:00:00.000Z', contentType: 'text/plain', payload: 'The build is red', meetingId: null, said: null, stale: null },
    });
    expect(calls.some((call) => call.startsWith('ack('))).toBe(false);
    expect(opened.held.size).toBe(0);
  });

  it('shows an item the person acknowledged and is not done with, read again from the fleet', async () => {
    const { readItem } = reading({ acknowledged: [WAITING] });

    await expect(readItem({ caller: CHARLOTTE_GRANT, deliveryId: WAITING.deliveryId })).resolves.toMatchObject({ isOk: true, value: { payload: 'The build is red', contentType: 'text/plain' } });
  });

  it('shows a done item whole from the ship\'s record, changing nothing', async () => {
    const { readItem, calls } = reading({ record: [DONE] });

    await expect(readItem({ caller: CHARLOTTE_GRANT, deliveryId: DONE.deliveryId })).resolves.toEqual({
      isOk: true,
      value: { deliveryId: DONE.deliveryId, from: 'tracker', title: 'Release 1.4 is out', sentAt: '2026-10-19T08:00:00.000Z', contentType: 'text/plain', payload: 'Release 1.4 is out', meetingId: null, said: null, stale: null },
    });
    expect(calls.some((call) => call.startsWith('ack(') || call.startsWith('handled('))).toBe(false);
    expect(opened.held.size).toBe(0);
  });

  it('finds a done item on an older page of the record', async () => {
    const newer = Array.from({ length: 25 }, (_, index): RecordedPersonDelivery => ({ ...DONE, deliveryId: `dlv_01m3tbfspe96yf1rnr4ank${String(index + 10).padStart(4, '0')}`, messageId: `msg_01m3tbfspe96yf1rnr4ank${String(index + 10).padStart(4, '0')}` }));
    const { readItem } = reading({ record: [DONE, ...newer] });

    await expect(readItem({ caller: CHARLOTTE_GRANT, deliveryId: DONE.deliveryId })).resolves.toMatchObject({ isOk: true, value: { payload: 'Release 1.4 is out' } });
  });

  it('refuses a delivery that is not the person ship\'s own', async () => {
    const { readItem } = reading({ deliveries: [WAITING], record: [DONE] });

    await expect(readItem({ caller: CHARLOTTE_GRANT, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0zzz' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_DELIVERY' } });
  });

  it('refuses a done item whose payload the fleet cannot unseal now', async () => {
    const { readItem } = reading({ record: [{ ...DONE, payload: '', isPayloadUnreadable: true }] });

    await expect(readItem({ caller: CHARLOTTE_GRANT, deliveryId: DONE.deliveryId })).resolves.toMatchObject({ isOk: false, error: { kind: 'KEY_UNAVAILABLE' } });
  });
});
