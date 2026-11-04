import { describe, expect, it } from 'vitest';

import { aPersonDelivery, fakePersonShipDoor, memoryLetGoDeliveries } from '../../../test/support/people-fakes.js';
import { ok } from '../shared/result.js';
import { createHeldDeliveries, holdingDoor } from './held-deliveries.js';
import type { PersonShipDoor } from './ports.js';

// What the gateway holds of a person ship's waiting deliveries lets go of
// each one the fleet no longer counts waiting because of the gateway's own
// call, and tells every gateway instance so (aeolus-fleet #1647).

const CREW = 'aeolus_ct_v1_charlotte';
const QUESTION = aPersonDelivery();
const NOTE = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', messageId: 'msg_01m3tbfspe96yf1rnr4ank0002' });

function holding(answers: Partial<PersonShipDoor> = {}) {
  const held = createHeldDeliveries();
  held.hold(CREW, [QUESTION, NOTE]);
  const ship = fakePersonShipDoor({ crewToken: CREW, deliveries: [QUESTION, NOTE] });
  const letGo = memoryLetGoDeliveries();
  return { held, letGo, door: holdingDoor({ ...ship.door, ...answers }, { held, letGo }) };
}

const heldIds = (held: ReturnType<typeof createHeldDeliveries>) => held.of(CREW)?.map(({ deliveryId }) => deliveryId);

describe('what the gateway holds lets go of what it acknowledged or handed for the last time', () => {
  it('lets go of a delivery the fleet took the acknowledgement of', async () => {
    const { held, door } = holding();

    await door.ack(CREW, QUESTION.deliveryId);

    expect(heldIds(held)).toEqual([NOTE.deliveryId]);
  });

  it('tells every gateway instance the delivery it let go of', async () => {
    const { letGo, door } = holding();

    await door.ack(CREW, QUESTION.deliveryId);

    expect(letGo.told).toEqual([QUESTION.deliveryId]);
  });

  it('keeps a delivery whose acknowledgement the fleet refused, telling no instance', async () => {
    const { held, letGo, door } = holding();

    await door.ack('aeolus_ct_v1_other', QUESTION.deliveryId);

    expect({ held: heldIds(held), told: letGo.told }).toEqual({ held: [QUESTION.deliveryId, NOTE.deliveryId], told: [] });
  });

  it.each(['acknowledged', 'undeliverable'] as const)('lets go of a delivery the fleet answers %s when handed', async (state) => {
    const { held, door } = holding({ handed: () => Promise.resolve(ok(state)) });

    await door.handed(CREW, { deliveryId: QUESTION.deliveryId, handOverNumber: 1, channel: 'web-push' });

    expect(heldIds(held)).toEqual([NOTE.deliveryId]);
  });

  it('keeps a delivery handed over that still waits, telling no instance', async () => {
    const { held, letGo, door } = holding();

    await door.handed(CREW, { deliveryId: QUESTION.deliveryId, handOverNumber: 1, channel: 'web-push' });

    expect({ held: heldIds(held), told: letGo.told }).toEqual({ held: [QUESTION.deliveryId, NOTE.deliveryId], told: [] });
  });

  it('lets go of a delivery another instance let go of, whatever crew holds it', () => {
    const { held } = holding();
    held.hold('aeolus_ct_v1_charlotte_2', [QUESTION]);

    held.letGo(QUESTION.deliveryId);

    expect({ crew: heldIds(held), otherCrew: held.of('aeolus_ct_v1_charlotte_2') }).toEqual({ crew: [NOTE.deliveryId], otherCrew: [] });
  });

  it('forgets all it holds once it may have missed a let-go, so the next look receives again', () => {
    const { held } = holding();

    held.forgetAll();

    expect(held.of(CREW)).toBeUndefined();
  });
});
