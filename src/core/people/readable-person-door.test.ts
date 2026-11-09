import { QUESTION_CONTENT_TYPE, STEP_CONTENT_TYPE } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { aPersonDelivery, fakePersonShipDoor, memoryLetGoDeliveries } from '../../../test/support/people-fakes.js';
import { FIXED_CLOCK } from '../../../test/support/fixed-clock.js';
import { createHeldDeliveries, holdingDoor } from './held-deliveries.js';
import { createReadablePersonDoor } from './readable-person-door.js';

const CREW = 'test-crew';
const ID = '9b2f6c1e-4a7d-4e0b-8c3f-2d5a6b7c8d9e';
const QUESTION = JSON.stringify({ id: ID, title: 'Release?', context: 'Checks passed', options: [{ key: 1, label: 'Go' }], pick: { option: 1, why: 'Ready' } });
const STEP = JSON.stringify({ id: ID, title: 'Sign in', why: 'Access is needed' });
const UNAVAILABLE = { code: 'UNAVAILABLE', message: 'Try again' };

function setup(contentType: string, payload: string) {
  const delivery = aPersonDelivery({ contentType, payload });
  const ship = fakePersonShipDoor({ crewToken: CREW, deliveries: [delivery] });
  const held = createHeldDeliveries(FIXED_CLOCK);
  const door = createReadablePersonDoor(holdingDoor(ship.door, { held, letGo: memoryLetGoDeliveries() }));
  return { delivery, ship, door, held };
}

describe('a person never reads a malformed question or step', () => {
  it.each([QUESTION_CONTENT_TYPE, STEP_CONTENT_TYPE])('returns %s to its sender before acknowledging and handling it', async (contentType) => {
    const { door, ship, delivery } = setup(contentType, '{}');
    expect(await door.pushReceive(CREW, { max: 10 })).toEqual({ isOk: true, value: [] });
    expect(ship.replies).toEqual([{ to: delivery.senderShipId, inReplyTo: delivery.messageId, contentType: 'text/plain', payload: expect.stringContaining('could not be read'), idempotencyKey: `unreadable-${delivery.deliveryId}` }]);
    expect(ship.replies[0]?.payload).toContain('title');
    expect(ship.calls.slice(1)).toEqual([`reply(${delivery.messageId})`, `ack(${delivery.deliveryId})`, `handled(${delivery.deliveryId})`]);
    expect(ship.ship.deliveries).toEqual([]);
  });

  it.each([[QUESTION_CONTENT_TYPE, QUESTION], [STEP_CONTENT_TYPE, STEP]])('leaves a valid %s unchanged', async (contentType, payload) => {
    const { door, ship, delivery } = setup(contentType, payload);
    expect(await door.pushReceive(CREW, { max: 10 })).toEqual({ isOk: true, value: [{ ...delivery, handOverNumber: null }] });
    expect(ship.replies).toEqual([]);
  });

  it('leaves an invalid JSON delivery retryable when the fleet refuses its reply', async () => {
    const { door, ship, delivery } = setup(QUESTION_CONTENT_TYPE, '{');
    ship.refusals.reply.push(UNAVAILABLE);
    expect(await door.pushReceive(CREW, { max: 10 })).toEqual({ isOk: false, error: UNAVAILABLE });
    expect(ship.ship.deliveries).toEqual([delivery]);
    expect(ship.calls).not.toContain(`ack(${delivery.deliveryId})`);
    await door.pushReceive(CREW, { max: 10 });
    expect(ship.replies[0]?.payload).toContain('Invalid JSON');
    expect(ship.ship.deliveries).toEqual([]);
  });

  it('uses the same reply key after a restart between reply and handling', async () => {
    const { door, ship, delivery } = setup(STEP_CONTENT_TYPE, '{}');
    ship.refusals.handled.push(UNAVAILABLE);
    expect(await door.pushReceive(CREW, { max: 10 })).toEqual({ isOk: false, error: UNAVAILABLE });
    const restarted = createReadablePersonDoor(ship.door);
    await restarted.delivery(CREW, delivery.deliveryId);
    expect(ship.replies.map(({ idempotencyKey }) => idempotencyKey)).toEqual([`unreadable-${delivery.deliveryId}`, `unreadable-${delivery.deliveryId}`]);
    expect(await ship.door.delivery(CREW, delivery.deliveryId)).toMatchObject({ isOk: false });
  });
});
