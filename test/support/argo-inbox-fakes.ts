/** argo's inbox as the gateway reads it, in memory for a test. */
import type { FleetId, MessageId, ShipId } from '@aeolus-fleet/common';

import type { ArgoAccount, ArgoAccounts, ArgoInboxDoor, ArgoInboxEntry, ArgoWakes } from '../../src/core/argo-inbox/ports.js';
import type { PersonShip, WakeChannelName } from '../../src/core/people/ports.js';
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
/** The trierarch, which sends argo its biggest problems. */
const TRIERARCH_SHIP_ID: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9trr';
export const TRIERARCH = { shipId: TRIERARCH_SHIP_ID, name: 'trierarch' };

/** A message to argo, numbered, from the trierarch unless told otherwise. */
export function anArgoEntry(number: number, overrides: Partial<ArgoInboxEntry> = {}): ArgoInboxEntry {
  const id = String(number).padStart(3, '0');
  return {
    messageId: `msg_01m3tbfspe96yf1rnr4ank9${id}`,
    deliveryId: `dlv_01m3tbfspe96yf1rnr4ank9${id}`,
    sender: TRIERARCH,
    contentType: 'text/markdown',
    sentAt: new Date(`2026-11-01T09:${id.slice(1)}:00.000Z`),
    deliveryState: 'pending',
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
    entries: new Map<MessageId, ArgoInboxEntry>(),
    /** Each change to a delivery to argo, by the message it concerns: its position is its index plus one. */
    events: new Array<MessageId>(),
    /** How many times every message to argo was read whole. */
    wholeReads: 0,
  };
  const change = (entry: ArgoInboxEntry) => {
    state.entries.set(entry.messageId, entry);
    state.events.push(entry.messageId);
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
    changes: (_crewToken, { afterSeq }) => refusedUnlessAnswering(() => ({ messageIds: state.isReadRuleOn ? state.events.slice(afterSeq) : [], lastSeq: state.events.length })),
  };
  return {
    state,
    door,
    /** A ship sends argo a message: core stores it Open and unread. */
    send: (entry: ArgoInboxEntry) => {
      change(entry);
    },
    /** argo marks it done in the console. */
    markDone: (messageId: MessageId) => {
      const entry = state.entries.get(messageId);
      if (entry !== undefined) {
        change({ ...entry, deliveryState: 'acknowledged' });
      }
    },
  };
}

/** For each person ship, the messages to argo a wake or a page in focus covered, and when each channel last woke it for argo, in memory; each read and write is kept, with the messages it names. */
export function memoryArgoWakes(): ArgoWakes & { covered: Map<string, Set<MessageId>>; sent: { ship: PersonShip; channel: WakeChannelName; sentAt: Date }[]; calls: { call: string; ship: PersonShip; messageIds: readonly MessageId[] }[] } {
  const covered = new Map<string, Set<MessageId>>();
  const sent: { ship: PersonShip; channel: WakeChannelName; sentAt: Date }[] = [];
  const calls: { call: string; ship: PersonShip; messageIds: readonly MessageId[] }[] = [];
  const keyOf = ({ fleetId, shipId }: PersonShip) => `${fleetId}/${shipId}`;
  const isShip = (ship: PersonShip) => (each: { ship: PersonShip }) => keyOf(each.ship) === keyOf(ship);
  return {
    covered,
    sent,
    calls,
    coveredAmong: (ship, messageIds) => {
      calls.push({ call: 'coveredAmong', ship, messageIds });
      const held = covered.get(keyOf(ship)) ?? new Set();
      return Promise.resolve(new Set(messageIds.filter((messageId) => held.has(messageId))));
    },
    cover: (ship, messageIds) => {
      calls.push({ call: 'cover', ship, messageIds });
      covered.set(keyOf(ship), new Set([...(covered.get(keyOf(ship)) ?? []), ...messageIds]));
      return Promise.resolve();
    },
    forget: (ship, messageIds) => {
      calls.push({ call: 'forget', ship, messageIds });
      covered.set(keyOf(ship), new Set([...(covered.get(keyOf(ship)) ?? [])].filter((messageId) => !messageIds.includes(messageId))));
      return Promise.resolve();
    },
    forgetAllBut: (ship, open) => {
      calls.push({ call: 'forgetAllBut', ship, messageIds: open });
      covered.set(keyOf(ship), new Set([...(covered.get(keyOf(ship)) ?? [])].filter((messageId) => open.includes(messageId))));
      return Promise.resolve();
    },
    lastSentAt: (ship, channel) => {
      calls.push({ call: 'lastSentAt', ship, messageIds: [] });
      return Promise.resolve(sent.filter(isShip(ship)).findLast((wake) => wake.channel === channel)?.sentAt);
    },
    record: (wake) => {
      calls.push({ call: 'record', ship: wake.ship, messageIds: [] });
      sent.push(wake);
      return Promise.resolve();
    },
  };
}
