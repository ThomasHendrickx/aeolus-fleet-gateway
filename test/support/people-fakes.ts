import type { FleetId, MessageId, ShipId } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../../src/core/connection/ports.js';
import type { BasketEntries, BasketEntry } from '../../src/core/people/basket.js';
import type { CrewPersonShip } from '../../src/core/people/crew-person-ship.js';
import type { ItemOutcome, ItemOutcomes } from '../../src/core/people/item-outcome.js';
import type { PersonCaller } from '../../src/core/people/person-crew.js';
import type { Route, Routes } from '../../src/core/people/routing.js';
import type { AccountDoor, FocusedPage, FocusedPages, Wake, WebPush, WebPushSent, WebPushSubscription, WebPushSubscriptions, InboxChange, InboxChanges, OpenedDeliveries, OpenedDelivery, PersonCrew, PersonCrews, PersonDelivery, PersonDiscovery, PersonSelector, PersonShipDoor, RecordedPersonDelivery } from '../../src/core/people/ports.js';
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
    headline: 'Go for release 1.4?',
    askedQuestionId: '9b2f',
    withdrawnQuestionId: null,
    stepId: null,
    withdrawnStepId: null,
    pick: null,
    stepLink: null,
    sentAt: new Date('2026-10-19T08:00:00.000Z'),
    inReplyTo: null,
    meetingId: null,
    ...overrides,
  };
}

/** The id the fleet gives a message a person sends. */
export const SENT_MESSAGE_ID: MessageId = 'msg_01m3tbfspe96yf1rnr4ank0sen';

/**
 * A person's ship in the fleet, as its crew's calls see it: the deliveries
 * waiting for it, each push receive handing the oldest again, up to max,
 * past the ones it is told to leave out unless it keeps no exclusions, as a
 * core before excluding does, with the last number the gateway handed it with;
 * the ones it acknowledged, read again until handled; what its discover
 * answers; its record, newest first by delivery id; its name, as whoami
 * answers it; the crew token it takes, and the calls the gateway made.
 */
export function fakePersonShipDoor(ship: { crewToken: string; name?: string; deliveries: PersonDelivery[]; discovery?: PersonDiscovery; record?: RecordedPersonDelivery[]; isExcludingIgnored?: boolean }) {
  const calls: string[] = [];
  /** The replies the fleet took, as sent. */
  const replies: Parameters<PersonShipDoor['reply']>[1][] = [];
  /** The messages the fleet took, as sent. */
  const sent: Parameters<PersonShipDoor['send']>[1][] = [];
  /** The fleet's answers to come for each call, before it takes them. */
  const refusals: { pushReceive: FleetRefusal[]; record: FleetRefusal[]; reply: FleetRefusal[]; handled: FleetRefusal[]; discover: FleetRefusal[]; send: FleetRefusal[]; delivery: FleetRefusal[]; whoami: FleetRefusal[] } = { pushReceive: [], record: [], reply: [], handled: [], discover: [], send: [], delivery: [], whoami: [] };
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
    pushReceive: (crewToken, { max, excluding = [] }) => {
      calls.push(excluding.length === 0 ? `pushReceive(${String(max)})` : `pushReceive(${String(max)}, excluding ${String(excluding.length)})`);
      const refused = refusals.pushReceive.shift();
      if (refused) {
        return Promise.resolve(err(refused));
      }
      const left = ship.isExcludingIgnored === true ? ship.deliveries : ship.deliveries.filter(({ deliveryId }) => !excluding.includes(deliveryId));
      return crewed(crewToken, () => left.slice(0, max).map((delivery) => ({ ...delivery, handOverNumber: handOvers.findLast(({ deliveryId }) => deliveryId === delivery.deliveryId)?.handOverNumber ?? null })));
    },
    record: (crewToken, { cursor, limit }) => {
      calls.push(`record(${cursor ?? 'newest'})`);
      const refused = refusals.record.shift();
      if (refused) {
        return Promise.resolve(err(refused));
      }
      return crewed(crewToken, () => {
        const newestFirst = [...(ship.record ?? [])].sort((a, b) => b.deliveryId.localeCompare(a.deliveryId)).filter(({ deliveryId }) => cursor === null || deliveryId < cursor);
        const items = newestFirst.slice(0, limit);
        return { items, nextCursor: newestFirst.length > limit ? (items.at(-1)?.deliveryId ?? null) : null };
      });
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
      // An acknowledged delivery is handed no more: core answers it acknowledged.
      if (acknowledged.some(({ deliveryId }) => deliveryId === handOver.deliveryId)) {
        return crewed(crewToken, () => 'acknowledged' as const);
      }
      return crewed(crewToken, () => {
        handOvers.push(handOver);
        return 'handed' as const;
      });
    },
    whoami: (crewToken) => {
      calls.push('whoami');
      const refused = refusals.whoami.shift();
      return refused ? Promise.resolve(err(refused)) : crewed(crewToken, () => ({ name: ship.name ?? 'charlotte' }));
    },
    discover: (crewToken) => {
      calls.push('discover');
      const refused = refusals.discover.shift();
      return refused ? Promise.resolve(err(refused)) : crewed(crewToken, () => ship.discovery ?? { ships: [], types: [] });
    },
    send: (crewToken, message) => {
      calls.push(`send(${recipientOf(message.to)})`);
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

function recipientOf(to: PersonSelector): string {
  switch (to.kind) {
    case 'ship':
      return to.name;
    case 'type':
      return to.type;
    case 'meeting':
      return to.meetingId;
  }
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

/** An entry of Charlotte's basket: option 2 to orchestrator-1's question, waiting for Send. */
export function aBasketEntry(overrides: Partial<BasketEntry> = {}): BasketEntry {
  return {
    fleetId: FLEET_ID,
    shipId: PERSON_SHIP_ID,
    questionId: '9b2f6c1e-4a7d-4e0b-8c3f-2d5a6b7c8d9e',
    deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001',
    messageId: 'msg_01m3tbfspe96yf1rnr4ank0001',
    senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9qrc',
    from: 'orchestrator-1',
    title: 'Which goes first: the Compact look (U4) or Harbour?',
    sentAt: new Date('2026-10-31T19:41:00.000Z'),
    option: 2,
    note: 'Harbour first: the demo on 12 Nov needs it.',
    addedAt: new Date('2026-10-31T19:53:00.000Z'),
    state: 'waiting',
    refusal: null,
    ...overrides,
  };
}

/** The basket of each person ship, in memory, by fleet, person ship and question. */
export function memoryBasketEntries(): BasketEntries & { held: Map<string, BasketEntry> } {
  const held = new Map<string, BasketEntry>();
  const key = (fleetId: FleetId, { shipId, questionId }: { shipId: string; questionId: string }) => `${fleetId}/${shipId}/${questionId}`;
  const ofShip = (fleetId: FleetId, shipId: ShipId) => [...held.values()].filter((entry) => entry.fleetId === fleetId && entry.shipId === shipId).sort((a, b) => a.addedAt.getTime() - b.addedAt.getTime());
  return {
    held,
    save: (entry) => {
      held.set(key(entry.fleetId, entry), entry);
      return Promise.resolve();
    },
    find: (fleetId, asked) => Promise.resolve(held.get(key(fleetId, asked))),
    list: (fleetId, shipId) => Promise.resolve(ofShip(fleetId, shipId)),
    count: (fleetId, shipId) => Promise.resolve(ofShip(fleetId, shipId).length),
    remove: (fleetId, removed) => {
      held.delete(key(fleetId, removed));
      return Promise.resolve();
    },
    sendingShips: ({ after, limit }) => {
      const ships = [...new Set([...held.values()].filter(({ state }) => state === 'sending').map(({ fleetId, shipId }) => `${fleetId}/${shipId}`))].sort();
      const from = after === null ? ships : ships.filter((ship) => ship > `${after.fleetId}/${after.shipId}`);
      return Promise.resolve(
        from.slice(0, limit).map((ship) => {
          const sending = [...held.values()].find(({ fleetId, shipId }) => `${fleetId}/${shipId}` === ship);
          if (sending === undefined) {
            throw new Error(`No entry of ${ship}`);
          }
          return { fleetId: sending.fleetId, shipId: sending.shipId };
        }),
      );
    },
  };
}

/** The outcomes of items the gateway kept, in memory, the first per delivery staying. */
export function memoryItemOutcomes(): ItemOutcomes & { held: ItemOutcome[] } {
  const held: ItemOutcome[] = [];
  return {
    held,
    save: ({ note = null, seen = null, ...outcome }) => {
      const kept = held.findIndex((each) => each.fleetId === outcome.fleetId && each.shipId === outcome.shipId && each.deliveryId === outcome.deliveryId);
      const sighting = outcome.kind === 'seen' ? { place: outcome.place, at: outcome.at } : seen;
      if (kept === -1) {
        held.push({ ...outcome, note, seen: sighting });
      } else if (held[kept]?.kind === 'seen' && outcome.kind !== 'seen') {
        // What came of an item seen before takes the place of seen, still saying where and when it was seen.
        held[kept] = { ...outcome, note, seen: held[kept].seen };
      }
      return Promise.resolve();
    },
    findMany: (fleetId, { shipId, deliveryIds }) => Promise.resolve(held.filter((kept) => kept.fleetId === fleetId && kept.shipId === shipId && deliveryIds.includes(kept.deliveryId))),
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

/** The person's pages in focus, in memory: each by its id, with when it was last seen in focus. */
export function memoryFocusedPages(): FocusedPages & { held: FocusedPage[] } {
  const held: FocusedPage[] = [];
  return {
    held,
    save: (page) => {
      const index = held.findIndex(({ pageId }) => pageId === page.pageId);
      held.splice(index < 0 ? held.length : index, index < 0 ? 0 : 1, page);
      return Promise.resolve();
    },
    remove: (fleetId, pageId) => {
      const index = held.findIndex((page) => page.fleetId === fleetId && page.pageId === pageId);
      if (index >= 0) {
        held.splice(index, 1);
      }
      return Promise.resolve();
    },
    isAnyInFocus: ({ fleetId, shipId }, since) => Promise.resolve(held.some((page) => page.fleetId === fleetId && page.shipId === shipId && page.seenAt >= since)),
  };
}
/** The browsers a person turned web push on in, in memory, by fleet, person ship and endpoint. */
export function memoryWebPushSubscriptions(): WebPushSubscriptions & { held: WebPushSubscription[] } {
  const held: WebPushSubscription[] = [];
  const isSame = (fleetId: FleetId, { shipId, endpoint }: { shipId: ShipId; endpoint: string }) => (subscription: WebPushSubscription) =>
    subscription.fleetId === fleetId && subscription.shipId === shipId && subscription.endpoint === endpoint;
  return {
    held,
    list: (fleetId, shipId) => Promise.resolve(held.filter((subscription) => subscription.fleetId === fleetId && subscription.shipId === shipId)),
    save: (subscription) => {
      const index = held.findIndex(isSame(subscription.fleetId, subscription));
      held.splice(index < 0 ? held.length : index, index < 0 ? 0 : 1, subscription);
      return Promise.resolve();
    },
    markGone: (fleetId, gone) => {
      const index = held.findIndex(isSame(fleetId, gone));
      const subscription = held[index];
      if (subscription !== undefined) {
        held[index] = { ...subscription, goneAt: gone.goneAt };
      }
      return Promise.resolve();
    },
    remove: (fleetId, removed) => {
      const index = held.findIndex(isSame(fleetId, removed));
      if (index >= 0) {
        held.splice(index, 1);
      }
      return Promise.resolve();
    },
  };
}

/** A browser of Charlotte's that took web push on, with its push service's endpoint. */
export function aWebPushSubscription(overrides: Partial<WebPushSubscription> = {}): WebPushSubscription {
  return {
    fleetId: FLEET_ID,
    shipId: PERSON_SHIP_ID,
    endpoint: 'https://push.example/send/firefox-1',
    keys: { p256dh: 'BPublicKeyOfTheBrowser', auth: 'AuthSecret' },
    browser: 'Firefox on Linux',
    fleetName: 'Acme',
    addedAt: new Date('2026-10-22T09:00:00.000Z'),
    goneAt: null,
    ...overrides,
  };
}

/** The browsers' push services, as the gateway's web push reaches them: each answers as the test sets it, sent by default. Every wake sent is kept. */
export function fakeWebPush() {
  const answers = new Map<string, WebPushSent[]>();
  const sent: { endpoint: string; wake: Wake }[] = [];
  const webPush: WebPush = {
    send: (subscription, wake) => {
      const answer = answers.get(subscription.endpoint)?.shift() ?? 'sent';
      if (answer === 'sent') {
        sent.push({ endpoint: subscription.endpoint, wake });
      }
      return Promise.resolve(answer);
    },
  };
  return { webPush, sent, answers };
}


/** The routes people chose, in memory, one per fleet, person ship, job and place. */
export function memoryRoutes(held: Route[] = []): Routes & { held: Route[] } {
  return {
    held,
    list: ({ fleetId, shipId }) => Promise.resolve(held.filter((route) => route.fleetId === fleetId && route.shipId === shipId)),
    save: (route) => {
      const index = held.findIndex((each) => each.fleetId === route.fleetId && each.shipId === route.shipId && each.job === route.job && each.place === route.place);
      held.splice(index < 0 ? held.length : index, index < 0 ? 0 : 1, route);
      return Promise.resolve();
    },
  };
}
