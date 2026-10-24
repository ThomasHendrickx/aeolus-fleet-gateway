import type { FleetId, MessageId, ShipId } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../../src/core/connection/ports.js';
import type { CrewPersonShip } from '../../src/core/people/crew-person-ship.js';
import type { PersonCaller } from '../../src/core/people/person-crew.js';
import type { AccountDoor, EmailChannels, InboxChange, InboxChanges, OpenedDeliveries, OpenedDelivery, PersonCrew, PersonCrews, PersonDelivery, PersonDiscovery, PersonShipDoor } from '../../src/core/people/ports.js';
import { err, ok, type Result } from '../../src/core/shared/result.js';

import { FLEET_ID } from './fleet-fakes.js';
import { PERSON_SHIP_ID } from './sign-in-fakes.js';

/**
 * The fleet as a person ship sees it in a test (core 0.28, aeolus-fleet
 * #990): an account gets a starting prompt for its own person ship, and
 * releases it, with its token beside the gateway's crew token; a session
 * registers with the prompt's secret. Every call is recorded.
 */
export function fakePersonShipFleet(options: { personShipId: ShipId; isCrewedElsewhere?: boolean }) {
  const calls: string[] = [];
  const state = { isCrewed: options.isCrewedElsewhere === true, issued: 0, calls };
  const isOwn = (call: { crewToken: string; accountToken: string; shipId: ShipId }) => call.crewToken === 'aeolus_ct_v1_gateway' && call.accountToken === 'account-token-1' && call.shipId === options.personShipId;
  const forbidden: FleetRefusal = { code: 'FORBIDDEN', message: 'is not your person ship' };
  const door: AccountDoor & { register(claim: { shipId: ShipId; secret: string }): Promise<Result<{ crewToken: string }, FleetRefusal>> } = {
    startingPrompt: async (call) => {
      state.calls.push(`startingPrompt ${call.shipId}`);
      await Promise.resolve();
      if (!isOwn(call)) {
        return err(forbidden);
      }
      if (state.isCrewed) {
        return err({ code: 'CONFLICT', message: 'is crewed: release it first' });
      }
      state.issued += 1;
      return ok({ secret: `secret-${String(state.issued)}` });
    },
    release: async (call) => {
      state.calls.push(`release ${call.shipId}`);
      await Promise.resolve();
      if (!isOwn(call)) {
        return err(forbidden);
      }
      state.isCrewed = false;
      return ok(undefined);
    },
    register: async ({ shipId, secret }) => {
      state.calls.push(`register ${shipId}`);
      await Promise.resolve();
      if (secret !== `secret-${String(state.issued)}` || state.isCrewed) {
        return err({ code: 'UNAUTHORIZED', message: 'secret refused' });
      }
      state.isCrewed = true;
      return ok({ crewToken: `aeolus_ct_v1_person_${String(state.issued)}` });
    },
  };
  return { door, state };
}

export function memoryPersonCrews(): PersonCrews & { held: PersonCrew[] } {
  const held: PersonCrew[] = [];
  return {
    held,
    crewed: ({ after, limit }) => {
      const key = ({ fleetId, shipId }: { fleetId: string; shipId: string }) => `${fleetId}/${shipId}`;
      const listed = held.map(({ fleetId, shipId }) => ({ fleetId, shipId })).sort((a, b) => key(a).localeCompare(key(b)));
      return Promise.resolve(listed.filter((ship) => after === null || key(ship) > key(after)).slice(0, limit));
    },
    find: (fleetId, shipId) => Promise.resolve(held.find((crew) => crew.fleetId === fleetId && crew.shipId === shipId)),
    save: (crew) => {
      held.push(crew);
      return Promise.resolve();
    },
    drop: (fleetId, shipId) => {
      const index = held.findIndex((crew) => crew.fleetId === fleetId && crew.shipId === shipId);
      if (index >= 0) {
        held.splice(index, 1);
      }
      return Promise.resolve();
    },
  };
}

/** Charlotte's sign-in in the fleet, whose account has a person ship: grant-1. */
export const CHARLOTTE_GRANT = { fleetId: FLEET_ID, grantId: 'grant-1' };

/**
 * The gateway's crew of Charlotte's person ship as part 4 gives it, over the
 * crews held: the one held, else a new crew, numbered from 1 (the first is
 * aeolus_ct_v1_charlotte). Any other grant's account has no person ship.
 */
export function fakeCrewPersonShip(crews: PersonCrews): CrewPersonShip & { crewed: number } {
  const crew = Object.assign(
    async (grant: PersonCaller) => {
      if (grant.fleetId !== CHARLOTTE_GRANT.fleetId || !('grantId' in grant) || grant.grantId !== CHARLOTTE_GRANT.grantId) {
        return err({ kind: 'noPersonShip' as const });
      }
      const held = await crews.find(grant.fleetId, PERSON_SHIP_ID);
      if (held !== undefined) {
        return ok({ shipId: PERSON_SHIP_ID, crewToken: held.crewToken });
      }
      crew.crewed += 1;
      const crewToken = crew.crewed === 1 ? 'aeolus_ct_v1_charlotte' : `aeolus_ct_v1_charlotte_${String(crew.crewed)}`;
      await crews.save({ fleetId: grant.fleetId, shipId: PERSON_SHIP_ID, crewToken, crewedAt: new Date('2026-10-19T09:00:00.000Z') });
      return ok({ shipId: PERSON_SHIP_ID, crewToken });
    },
    { crewed: 0 },
  );
  return crew;
}

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

/** The id the fleet gives a message a person sends. */
export const SENT_MESSAGE_ID: MessageId = 'msg_01m3tbfspe96yf1rnr4ank0sen';

/**
 * A person's ship in the fleet, as its crew's calls see it: the deliveries
 * waiting for it, each push receive handing the oldest again, up to max,
 * with the last number the gateway handed it with;
 * the ones it acknowledged, read again until handled; what its discover
 * answers; the crew token it takes, and the calls the gateway made.
 */
export function fakePersonShipDoor(ship: { crewToken: string; deliveries: PersonDelivery[]; discovery?: PersonDiscovery }) {
  const calls: string[] = [];
  /** The replies the fleet took, as sent. */
  const replies: Parameters<PersonShipDoor['reply']>[1][] = [];
  /** The messages the fleet took, as sent. */
  const sent: Parameters<PersonShipDoor['send']>[1][] = [];
  /** The fleet's answers to come for each call, before it takes them. */
  const refusals: { reply: FleetRefusal[]; handled: FleetRefusal[]; discover: FleetRefusal[]; send: FleetRefusal[]; delivery: FleetRefusal[] } = { reply: [], handled: [], discover: [], send: [], delivery: [] };
  /** The hand-overs the gateway reported, in order. */
  const handOvers: Parameters<PersonShipDoor['handed']>[1][] = [];
  /** The deliveries the ship acknowledged and has not handled yet. */
  let acknowledged: PersonDelivery[] = [];
  const refusal: FleetRefusal = { code: 'UNAUTHORIZED', message: 'The crew token is not valid' };
  const crewed = <T>(crewToken: string, value: () => T): Promise<Result<T, FleetRefusal>> => Promise.resolve(crewToken === ship.crewToken ? ok(value()) : err(refusal));
  const door: PersonShipDoor = {
    inbox: (crewToken) => {
      calls.push('inbox');
      return crewed(crewToken, () => ({ waiting: ship.deliveries.length }));
    },
    pushReceive: (crewToken, { max }) => {
      calls.push(`pushReceive(${String(max)})`);
      return crewed(crewToken, () => ship.deliveries.slice(0, max).map((delivery) => ({ ...delivery, handOverNumber: handOvers.findLast(({ deliveryId }) => deliveryId === delivery.deliveryId)?.handOverNumber ?? null })));
    },
    ack: (crewToken, deliveryId) => {
      calls.push(`ack(${deliveryId})`);
      return crewed(crewToken, () => {
        acknowledged = [...acknowledged, ...ship.deliveries.filter((delivery) => delivery.deliveryId === deliveryId)];
        ship.deliveries = ship.deliveries.filter((delivery) => delivery.deliveryId !== deliveryId);
        return undefined;
      });
    },
    delivery: (crewToken, deliveryId) => {
      calls.push(`delivery(${deliveryId})`);
      const reread = acknowledged.find((delivery) => delivery.deliveryId === deliveryId);
      const refused = refusals.delivery.shift() ?? (reread ? undefined : { code: 'DELIVERY_NOT_FOUND', message: `Delivery ${deliveryId} does not exist` });
      return refused || !reread ? Promise.resolve(err(refused ?? refusal)) : crewed(crewToken, () => reread);
    },
    reply: (crewToken, reply) => {
      calls.push(`reply(${reply.inReplyTo})`);
      const refused = refusals.reply.shift();
      if (refused) {
        return Promise.resolve(err(refused));
      }
      return crewed(crewToken, () => {
        replies.push(reply);
        return undefined;
      });
    },
    handled: (crewToken, deliveryId) => {
      calls.push(`handled(${deliveryId})`);
      const refused = refusals.handled.shift();
      return refused
        ? Promise.resolve(err(refused))
        : crewed(crewToken, () => {
            acknowledged = acknowledged.filter((delivery) => delivery.deliveryId !== deliveryId);
            return undefined;
          });
    },
    handed: (crewToken, handOver) => {
      calls.push(`handed(${handOver.deliveryId})`);
      return crewed(crewToken, () => {
        handOvers.push(handOver);
        return 'handed' as const;
      });
    },
    discover: (crewToken) => {
      calls.push('discover');
      const refused = refusals.discover.shift();
      return refused ? Promise.resolve(err(refused)) : crewed(crewToken, () => ship.discovery ?? { ships: [], types: [] });
    },
    send: (crewToken, message) => {
      calls.push(`send(${message.to.kind === 'ship' ? message.to.name : message.to.type})`);
      const refused = refusals.send.shift();
      if (refused) {
        return Promise.resolve(err(refused));
      }
      return crewed(crewToken, () => {
        sent.push(message);
        return { messageId: SENT_MESSAGE_ID };
      });
    },
  };
  return { door, calls, replies, sent, refusals, handOvers };
}

/** The deliveries people opened, in memory, by fleet, person ship and delivery. */
export function memoryOpenedDeliveries(): OpenedDeliveries & { held: Map<string, OpenedDelivery> } {
  const held = new Map<string, OpenedDelivery>();
  const key = (fleetId: FleetId, { shipId, deliveryId }: { shipId: string; deliveryId: string }) => `${fleetId}/${shipId}/${deliveryId}`;
  return {
    held,
    save: (opened) => {
      held.set(key(opened.fleetId, opened), opened);
      return Promise.resolve();
    },
    find: (fleetId, opened) => Promise.resolve(held.get(key(fleetId, opened))),
    list: (fleetId, shipId) => Promise.resolve([...held.values()].filter((opened) => opened.fleetId === fleetId && opened.shipId === shipId).sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime())),
    remove: (fleetId, opened) => {
      held.delete(key(fleetId, opened));
      return Promise.resolve();
    },
  };
}

/** The inbox changes the gateway told, in memory, in the order told. */
export function memoryInboxChanges(): InboxChanges & { told: InboxChange[] } {
  const told: InboxChange[] = [];
  return {
    told,
    tell: (change) => {
      told.push(change);
      return Promise.resolve();
    },
  };
}

/** The email channels people turned on, in memory, by fleet and person ship. */
export function memoryEmailChannels(): EmailChannels & { turnedOn: Map<string, Date> } {
  const turnedOn = new Map<string, Date>();
  const key = ({ fleetId, shipId }: { fleetId: string; shipId: string }) => `${fleetId}/${shipId}`;
  return {
    turnedOn,
    isOn: (ship) => Promise.resolve(turnedOn.has(key(ship))),
    turn: (ship, { isOn, at }) => {
      if (isOn) {
        turnedOn.set(key(ship), turnedOn.get(key(ship)) ?? at);
      } else {
        turnedOn.delete(key(ship));
      }
      return Promise.resolve();
    },
  };
}
