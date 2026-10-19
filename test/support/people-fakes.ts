import type { FleetRefusal } from '../../src/core/connection/ports.js';
import type { PersonDelivery, PersonShipDoor } from '../../src/core/people/ports.js';
import { err, ok, type Result } from '../../src/core/shared/result.js';

/** A delivery to a person's ship, as the fleet's push receive hands it: a question from the issue tracker by default. */
export function aPersonDelivery(overrides: Partial<PersonDelivery> = {}): PersonDelivery {
  return {
    deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001',
    messageId: 'msg_01m3tbfspe96yf1rnr4ank0001',
    senderName: 'tracker',
    contentType: 'application/vnd.aeolus.question+json',
    payload: '{"id":"9b2f","title":"Go for release 1.4?","context":"All checks are green.","options":[{"key":1,"label":"Go"}]}',
    questionTitle: 'Go for release 1.4?',
    sentAt: new Date('2026-10-19T08:00:00.000Z'),
    inReplyTo: null,
    ...overrides,
  };
}

/**
 * A person's ship in the fleet, as its crew's calls see it: the deliveries
 * waiting for it, each push receive handing the oldest again, up to max; the
 * crew tokens it takes, and the calls the gateway made.
 */
export function fakePersonShipDoor(ship: { crewToken: string; deliveries: PersonDelivery[] }) {
  const calls: string[] = [];
  const refusal: FleetRefusal = { code: 'UNAUTHORIZED', message: 'The crew token is not valid' };
  const crewed = <T>(crewToken: string, value: () => T): Promise<Result<T, FleetRefusal>> => Promise.resolve(crewToken === ship.crewToken ? ok(value()) : err(refusal));
  const door: PersonShipDoor = {
    inbox: (crewToken) => {
      calls.push('inbox');
      return crewed(crewToken, () => ({ waiting: ship.deliveries.length }));
    },
    pushReceive: (crewToken, { max }) => {
      calls.push(`pushReceive(${String(max)})`);
      return crewed(crewToken, () => ship.deliveries.slice(0, max));
    },
  };
  return { door, calls };
}
