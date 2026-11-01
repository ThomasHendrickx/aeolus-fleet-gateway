/** argo's inbox as the gateway reads it, in memory for a test. */
import type { FleetId, MessageId, ShipId } from '@aeolus-fleet/common';

import type { ArgoSlackPost } from '../../src/core/argo-inbox/argo-slack-post.js';
import type { ArgoAccount, ArgoAccounts, ArgoSlackPosts, ArgoInboxChange, ArgoInboxDoor, ArgoMessageRead } from '../../src/core/argo-inbox/ports.js';
import { err, ok, type Result } from '../../src/core/shared/result.js';

/** The accounts allowed as argo, per fleet, held in memory. */
export function memoryArgoAccounts(): ArgoAccounts & { held: Map<FleetId, Map<string, ArgoAccount>> } {
  const held = new Map<FleetId, Map<string, ArgoAccount>>();
  return {
    held,
    keep: (fleetId, account) => {
      held.set(fleetId, new Map(held.get(fleetId)).set(account.accountId, account));
      return Promise.resolve();
    },
    drop: (fleetId, accountId) => {
      held.get(fleetId)?.delete(accountId);
      return Promise.resolve();
    },
    list: (fleetId) => Promise.resolve([...(held.get(fleetId)?.values() ?? [])]),
  };
}

/** argo's ship in a test fleet. */
export const ARGO_SHIP_ID: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9arg';
/** The trierarch of thomas-mac, named for its computer, which sends argo its biggest problems. */
const TRIERARCH_SHIP_ID: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9trr';
export const TRIERARCH = { shipId: TRIERARCH_SHIP_ID, name: 'thomas-mac' };

/** A message to argo, numbered, from the trierarch unless told otherwise. */
export function anArgoEntry(number: number, overrides: Partial<ArgoMessageRead> = {}): ArgoMessageRead {
  const id = String(number).padStart(3, '0');
  return {
    messageId: `msg_01m3tbfspe96yf1rnr4ank9${id}`,
    deliveryId: `dlv_01m3tbfspe96yf1rnr4ank9${id}`,
    sender: TRIERARCH,
    contentType: 'text/markdown',
    sentAt: new Date(`2026-11-01T09:${id.slice(1)}:00.000Z`),
    deliveryState: 'pending',
    headline: 'thomas-mac is low on disk: 4% free',
    ...overrides,
  };
}

const NOT_ANSWERING = { code: 'UNAVAILABLE', message: 'The fleet did not answer' };

/**
 * argo's inbox as the fleet answers the gateway's ship, in memory: argo's
 * messages and their deliveries' states, each change an event in order,
 * read only while argo's read rule lets the ship read argo, and nothing
 * while the fleet does not answer.
 */
export function fakeArgoInboxFleet() {
  const state = {
    isReadRuleOn: true,
    isAnswering: true,
    entries: new Map<MessageId, ArgoMessageRead>(),
    /** Each change to a delivery to argo, by the message it concerns: its position is its index plus one. */
    events: new Array<ArgoInboxChange>(),
    /** How many times every message to argo was read whole. */
    wholeReads: 0,
    /** Each ship's type as the fleet answers it. */
    types: new Map<ShipId, string>([[TRIERARCH_SHIP_ID, 'trierarch']]),
    /** Each ship whose type was read, in order. */
    typeReads: new Array<ShipId>(),
  };
  const change = (entry: ArgoMessageRead, by: Omit<ArgoInboxChange, 'messageId'>) => {
    state.entries.set(entry.messageId, entry);
    state.events.push({ messageId: entry.messageId, ...by });
  };
  const refusedUnlessAnswering = <T>(answer: () => T): Promise<Result<T, { code: string; message: string }>> => Promise.resolve(state.isAnswering ? ok(answer()) : err(NOT_ANSWERING));
  const door: ArgoInboxDoor = {
    argoInReach: () => refusedUnlessAnswering(() => (state.isReadRuleOn ? ARGO_SHIP_ID : null)),
    position: () => refusedUnlessAnswering(() => state.events.length),
    entries: () =>
      refusedUnlessAnswering(() => {
        state.wholeReads += 1;
        return state.isReadRuleOn ? [...state.entries.values()] : [];
      }),
    entry: (_crewToken, { messageId }) => refusedUnlessAnswering(() => (state.isReadRuleOn ? (state.entries.get(messageId) ?? null) : null)),
    shipType: (_crewToken, shipId) =>
      refusedUnlessAnswering(() => {
        state.typeReads.push(shipId);
        return state.types.get(shipId) ?? 'agent';
      }),
    changes: (_crewToken, { afterSeq }) => refusedUnlessAnswering(() => ({ changes: state.isReadRuleOn ? state.events.slice(afterSeq) : [], lastSeq: state.events.length })),
  };
  return {
    state,
    door,
    /** A ship sends argo a message: core stores it Open and unread. */
    send: (entry: ArgoMessageRead) => {
      change(entry, { at: entry.sentAt, accountId: null });
    },
    /** argo marks it done in the console, by default at 20:14 with no account signed in as argo named. */
    markDone: (messageId: MessageId, by: Partial<Omit<ArgoInboxChange, 'messageId'>> = {}) => {
      const entry = state.entries.get(messageId);
      if (entry !== undefined) {
        change({ ...entry, deliveryState: 'acknowledged' }, { at: new Date('2026-11-01T20:14:00.000Z'), accountId: null, ...by });
      }
    },
  };
}

/** The messages open at argo in Slack, in memory, one per fleet, person ship and message. */
export function memoryArgoSlackPosts(): ArgoSlackPosts & { held: ArgoSlackPost[] } {
  const held = new Array<ArgoSlackPost>();
  const indexOf = (fleetId: FleetId, { personShipId, messageId }: { personShipId: ShipId; messageId: MessageId }) =>
    held.findIndex((post) => post.fleetId === fleetId && post.personShipId === personShipId && post.messageId === messageId);
  return {
    held,
    list: (fleetId) => Promise.resolve(held.filter((post) => post.fleetId === fleetId)),
    keep: (post) => {
      if (indexOf(post.fleetId, post) !== -1) {
        return Promise.resolve('known');
      }
      held.push(post);
      return Promise.resolve('kept');
    },
    save: (post) => {
      const index = indexOf(post.fleetId, post);
      if (index !== -1) {
        held[index] = post;
      }
      return Promise.resolve();
    },
    remove: (fleetId, post) => {
      const index = indexOf(fleetId, post);
      if (index !== -1) {
        held.splice(index, 1);
      }
      return Promise.resolve();
    },
  };
}
