/**
 * Bridge's form to send a ship a message (aeolus-fleet #1547,
 * send-message.html): which ships it offers, when Send is on, the key a
 * send carries, why one failed, what the toast says once the fleet stored
 * it, and the ship an opened alert is about. Pure view logic, no React and
 * no API client.
 */
import { ALERT_CONTENT_TYPE } from '@aeolus-fleet/common';
import type { inferRouterOutputs } from '@trpc/server';
import { z } from 'zod';

import type { GatewayRouter } from '../../../../src/adapters/trpc/router.js';
import { SHIP_STATES, type ShipState, type YourFleet } from '../fleet/services/your-fleet';

/** Who the person can send a message to, as the API answers it: the ships their person ship may send to now, and the name it sends as. */
export type SendTo = inferRouterOutputs<GatewayRouter>['people']['sendTo'];

/** A ship the form offers: by name, with its state as Your fleet shows it, none where Your fleet does not show the ship. */
export interface SendableShip {
  readonly name: string;
  readonly state: ShipState | null;
}

/**
 * The ships the person ship may send to, each in its state as Your fleet
 * shows it, in Your fleet's order: alerts first, then waiting, working and
 * idle, ties by name; a ship Your fleet does not show, or every ship when it
 * could not be read, comes after, with no state.
 */
export function sendableShipsOf(ships: readonly string[], fleet: YourFleet | undefined): readonly SendableShip[] {
  const states = new Map((fleet?.groups ?? []).flatMap(({ tiles }) => tiles.map(({ name, state }) => [name, state] as const)));
  const rank = (state: ShipState | null) => (state === null ? SHIP_STATES.length : SHIP_STATES.indexOf(state));
  return ships
    .map((name) => ({ name, state: states.get(name) ?? null }))
    .toSorted((one, other) => rank(one.state) - rank(other.state) || one.name.localeCompare(other.name));
}

/** The ships whose name holds what the person typed, whatever its case; every ship while nothing is typed. */
export function shipsMatching(ships: readonly SendableShip[], typed: string): readonly SendableShip[] {
  const sought = typed.trim().toLowerCase();
  return sought === '' ? ships : ships.filter(({ name }) => name.toLowerCase().includes(sought));
}

/** Send is on once a ship is picked and something is written. */
export function isSendable({ to, message }: { to: string | null; message: string }): boolean {
  return to !== null && message.trim() !== '';
}

/** A send the form made: its key, and the ship and message it carried. */
export interface LastSend {
  readonly key: string;
  readonly to: string;
  readonly message: string;
}

/**
 * The key a send carries: the last send's again while the ship and the
 * message are the same, so a message sent again arrives once; a new one
 * otherwise, as a changed message is a new message.
 */
export function keyToSend({ last, to, message, newKey }: { last: LastSend | null; to: string; message: string; newKey: string }): string {
  return last !== null && last.to === to && last.message === message ? last.key : newKey;
}

/** Why a send failed: the fleet refused it, in its own words, or no answer came, so it may be stored. */
export type SendFailure = { readonly kind: 'refused'; readonly reason: string } | { readonly kind: 'noAnswer' };

/** The API's codes for a send the fleet refused: its reason is the person's to read. */
const REFUSED_CODES = new Set(['BAD_REQUEST', 'FORBIDDEN']);

/** A refusal when the fleet refused the send; no answer for anything else, as the message may be stored. */
export function sendFailureOf({ code, message }: { code?: string | undefined; message: string }): SendFailure {
  return code !== undefined && REFUSED_CODES.has(code) ? { kind: 'refused', reason: message } : { kind: 'noAnswer' };
}

/** Where a time shows to the minute in an ISO 8601 time: hours and minutes, in UTC. */
const MINUTE = { start: 11, end: 16 } as const;

/** What the toast says once the fleet stored the message: to whom, when in UTC as every Bridge time, and as which person ship. */
export function sentNoticeOf({ to, sentAs, storedAt }: { to: string; sentAs: string; storedAt: string }): { title: string; description: string } {
  return {
    title: `Sent to ${to}`,
    description: `Stored by the fleet at ${new Date(storedAt).toISOString().slice(MINUTE.start, MINUTE.end)} UTC, sent as ${sentAs}. ${to} receives it when it next looks.`,
  };
}

/** What Bridge reads of an alert to send its ship a message: the ship, by name. */
const alertShipSchema = z.object({ ship: z.object({ name: z.string().min(1) }) });

/** The ship an alert is about, by name; none for any other message, or an alert whose payload does not read. */
export function alertShipOf(opened: { contentType: string; payload: string }): string | undefined {
  const [essence = ''] = opened.contentType.split(';');
  if (essence.trim().toLowerCase() !== ALERT_CONTENT_TYPE) {
    return undefined;
  }
  try {
    return alertShipSchema.safeParse(JSON.parse(opened.payload)).data?.ship.name;
  } catch {
    return undefined;
  }
}
