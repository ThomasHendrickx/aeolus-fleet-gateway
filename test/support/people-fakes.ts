import type { FleetRefusal } from '../../src/core/connection/ports.js';
import type { FleetId } from '@aeolus-fleet/common';

import type { OpenedDeliveries, OpenedDelivery, PersonDelivery, PersonShipDoor } from '../../src/core/people/ports.js';
import { err, ok, type Result } from '../../src/core/shared/result.js';

/** A delivery to a person's ship, as the fleet's push receive hands it: a question from the issue tracker by default. */
export function aPersonDelivery(overrides: Partial<PersonDelivery> = {}): PersonDelivery {
  return {
    deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001',
    messageId: 'msg_01m3tbfspe96yf1rnr4ank0001',
    senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9trk',
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
  /** The replies the fleet took, as sent. */
  const replies: Parameters<PersonShipDoor['reply']>[1][] = [];
  /** The fleet's answers to come for reply and handled, before it takes them. */
  const refusals: { reply: FleetRefusal[]; handled: FleetRefusal[] } = { reply: [], handled: [] };
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
    ack: (crewToken, deliveryId) => {
      calls.push(`ack(${deliveryId})`);
      return crewed(crewToken, () => {
        ship.deliveries = ship.deliveries.filter((delivery) => delivery.deliveryId !== deliveryId);
      });
    },
    reply: (crewToken, reply) => {
      calls.push(`reply(${reply.inReplyTo})`);
      const refused = refusals.reply.shift();
      if (refused) {
        return Promise.resolve(err(refused));
      }
      return crewed(crewToken, () => {
        replies.push(reply);
      });
    },
    handled: (crewToken, deliveryId) => {
      calls.push(`handled(${deliveryId})`);
      const refused = refusals.handled.shift();
      return refused ? Promise.resolve(err(refused)) : crewed(crewToken, () => undefined);
    },
  };
  return { door, calls, replies, refusals };
}

/** The deliveries people opened, in memory, by fleet, party and delivery. */
export function memoryOpenedDeliveries(): OpenedDeliveries & { held: Map<string, OpenedDelivery> } {
  const held = new Map<string, OpenedDelivery>();
  const key = (fleetId: FleetId, { party, deliveryId }: { party: string; deliveryId: string }) => `${fleetId}/${party}/${deliveryId}`;
  return {
    held,
    save: (opened) => {
      held.set(key(opened.fleetId, opened), opened);
      return Promise.resolve();
    },
    find: (fleetId, opened) => Promise.resolve(held.get(key(fleetId, opened))),
    remove: (fleetId, opened) => {
      held.delete(key(fleetId, opened));
      return Promise.resolve();
    },
  };
}
