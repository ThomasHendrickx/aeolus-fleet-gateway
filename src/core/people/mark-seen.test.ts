import { beforeEach, describe, expect, it } from 'vitest';

import { CHARLOTTE_GRANT, fakeCrewPersonShip, fakePersonShipDoor, memoryPersonCrews, type ExchangeFixture } from '../../../test/support/people-fakes.js';
import { createMarkSeen } from './mark-seen.js';

// A person marks one ship's plain messages seen up to one message, in one
// call. Core acknowledges them and leaves questions, steps, alerts and
// notices as they are; the gateway only asks, once.

const TRACKER = 'shp_01m3tbfspe96yf1rnr4ank9trk';

function aMessage(n: number): ExchangeFixture['messages'][number] {
  const suffix = String(n).padStart(4, '0');
  return { deliveryId: `dlv_01m3tbfspe96yf1rnr4ank${suffix}`, messageId: `msg_01m3tbfspe96yf1rnr4ank${suffix}`, otherShipId: TRACKER, senderShipId: TRACKER, payload: `Message ${String(n)}`, isPayloadUnreadable: false, contentType: 'text/plain', inReplyTo: null, sentAt: '2026-11-06T10:00:00.000Z', deliveryState: null, receivedDelivery: null };
}

let crews: ReturnType<typeof memoryPersonCrews>;

beforeEach(() => {
  crews = memoryPersonCrews();
});

function marking() {
  const fleet = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries: [], exchanges: { summaries: [], messages: [1, 2, 3, 4].map(aMessage) } });
  return { ...fleet, markSeen: createMarkSeen({ crewPersonShip: fakeCrewPersonShip(crews), crews, door: fleet.door }) };
}

describe('a person marks an exchange seen up to one message', () => {
  it('marks the ship\'s messages up to the named one in a single call and says how many', async () => {
    const { markSeen, calls } = marking();

    await expect(markSeen({ caller: CHARLOTTE_GRANT, otherShipId: TRACKER, messageId: 'msg_01m3tbfspe96yf1rnr4ank0003' })).resolves.toEqual({ isOk: true, value: { acknowledged: 3 } });
    expect(calls.filter((call) => !call.startsWith('whoami'))).toEqual([`ackUpTo(${TRACKER}, msg_01m3tbfspe96yf1rnr4ank0003)`]);
  });

  it('changes nothing when marked again, and says none were acknowledged', async () => {
    const { markSeen } = marking();
    await markSeen({ caller: CHARLOTTE_GRANT, otherShipId: TRACKER, messageId: 'msg_01m3tbfspe96yf1rnr4ank0003' });

    await expect(markSeen({ caller: CHARLOTTE_GRANT, otherShipId: TRACKER, messageId: 'msg_01m3tbfspe96yf1rnr4ank0003' })).resolves.toEqual({ isOk: true, value: { acknowledged: 0 } });
  });

  it('refuses a message that is not from that ship to the person ship', async () => {
    const { markSeen, refusals } = marking();
    refusals.ackUpTo.push({ code: 'NOT_FOUND', message: 'No such message' });

    await expect(markSeen({ caller: CHARLOTTE_GRANT, otherShipId: TRACKER, messageId: 'msg_01m3tbfspe96yf1rnr4ank0zzz' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_MESSAGE' } });
  });

  it('says nothing was marked when the fleet does not answer, so the person marks again', async () => {
    const { markSeen, refusals } = marking();
    refusals.ackUpTo.push({ code: 'INTERNAL', message: 'The fleet is busy' });

    await expect(markSeen({ caller: CHARLOTTE_GRANT, otherShipId: TRACKER, messageId: 'msg_01m3tbfspe96yf1rnr4ank0003' })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });
});
