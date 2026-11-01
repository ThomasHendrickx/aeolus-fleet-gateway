/**
 * The basket (docs/design/bridge, section 9; CC21): answers to questions the
 * person picked in Bridge and has not sent, kept per fleet and person ship,
 * one entry per question, by its uuid. Nothing is sent until the person
 * presses Send N answers; then each entry is stored as sending, and the
 * gateway sends each on its own, in the order added, until the fleet stores
 * it or refuses it. An entry keeps what its answer and the basket's list
 * need, so it is sent, and shown, whatever came of its opened delivery.
 */
import type { DeliveryId, FleetId, MessageId, ShipId } from '@aeolus-fleet/common';

import type { ItemOutcome, Place } from './item-outcome.js';
import type { Stale } from './stale-item.js';

/** Where an entry is: waiting for Send, stored as sending, or refused by the fleet, not sent. */
export type BasketEntryState = 'waiting' | 'sending' | 'refused';

export interface BasketEntry {
  readonly fleetId: FleetId;
  readonly shipId: ShipId;
  /** The uuid of the question it answers (decision 0038): one entry per question. */
  readonly questionId: string;
  readonly deliveryId: DeliveryId;
  /** The question's message, which the answer is in reply to, and its asker. */
  readonly messageId: MessageId;
  readonly senderShipId: ShipId;
  readonly from: string;
  readonly title: string;
  /** When the question was asked. */
  readonly sentAt: Date;
  /** The option picked; none for a note alone (decision 0038). */
  readonly option: number | null;
  /** The option's label, as the question shows it, so the basket names the answer; none for a note alone. */
  readonly optionLabel: string | null;
  /** The note that goes with the answer; none when the person wrote none. */
  readonly note: string | null;
  /** When it was put in the basket: entries are sent in this order, and changing one keeps its place. */
  readonly addedAt: Date;
  readonly state: BasketEntryState;
  /** Why the fleet refused it, while refused. */
  readonly refusal: string | null;
}

/** Outbound port: the basket of each person ship, by fleet, person ship and question. */
export interface BasketEntries {
  /** Keeps it, or keeps it anew when its question has an entry already. */
  save(entry: BasketEntry): Promise<void>;
  find(fleetId: FleetId, asked: { shipId: ShipId; questionId: string }): Promise<BasketEntry | undefined>;
  /** The person ship's, in the order added. */
  list(fleetId: FleetId, shipId: ShipId): Promise<BasketEntry[]>;
  /** How many entries the person ship's basket holds. */
  count(fleetId: FleetId, shipId: ShipId): Promise<number>;
  remove(fleetId: FleetId, removed: { shipId: ShipId; questionId: string }): Promise<void>;
  /** The person ships with an entry stored as sending, of every fleet, by fleet and ship, after the one given. */
  sendingShips(page: { after: { fleetId: FleetId; shipId: ShipId } | null; limit: number }): Promise<{ fleetId: FleetId; shipId: ShipId }[]>;
}

/**
 * What an entry stands as now: as kept (waiting, sending, refused with
 * why); its question withdrawn or replaced by its asker (section 9, rule
 * 5); or dealt with elsewhere, as when Slack or a chat answered it first
 * (rule 6): either is not sent.
 */
export type BasketStanding =
  | { readonly kind: 'waiting' }
  | { readonly kind: 'sending' }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'withdrawn' }
  | { readonly kind: 'replaced'; readonly replacementId: DeliveryId | null }
  | { readonly kind: 'dealtElsewhere'; readonly place: Place; readonly option: number | null };

/**
 * An entry's standing, from what came of its question, if anything did, and
 * whether its asker withdrew or replaced it. Once sending, the answer goes:
 * a withdrawal that comes later is the asker's business (section 9).
 */
export function standingOf(entry: BasketEntry, known: { outcome: ItemOutcome | undefined; stale: Stale | null }): BasketStanding {
  const { outcome, stale } = known;
  if (outcome !== undefined) {
    switch (outcome.kind) {
      case 'withdrawn':
        return { kind: 'withdrawn' };
      case 'replaced':
        return { kind: 'replaced', replacementId: null };
      case 'seen':
      case 'answered':
      case 'done':
      case 'cannot':
      case 'notSent':
        return { kind: 'dealtElsewhere', place: outcome.place, option: outcome.option };
    }
  }
  switch (entry.state) {
    case 'sending':
      return { kind: 'sending' };
    case 'refused':
      return { kind: 'refused', reason: entry.refusal ?? 'The fleet refused it' };
    case 'waiting':
      if (stale === null) {
        return { kind: 'waiting' };
      }
      return stale.kind === 'withdrawn' ? { kind: 'withdrawn' } : { kind: 'replaced', replacementId: stale.replacementId };
  }
}

/** The answer an entry sends (decision 0038): its question's uuid, its option if any, and its note if any. */
export function answerOf(entry: Pick<BasketEntry, 'questionId' | 'option' | 'note'>): { questionId: string; option?: number; note?: string } {
  return { questionId: entry.questionId, ...(entry.option === null ? {} : { option: entry.option }), ...(entry.note === null ? {} : { note: entry.note }) };
}

/** The key an entry's answer is sent under: the question's, so it is stored once however often it is sent (section 9). */
export function answerKeyOf(entry: Pick<BasketEntry, 'questionId'>): string {
  return `answer-${entry.questionId}`;
}
