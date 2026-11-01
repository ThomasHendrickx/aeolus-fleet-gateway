/**
 * What came of an item and where (docs/design/bridge, CC4): the gateway
 * keeps it when the person acts on a delivery to their person ship, since
 * core's record keeps the delivery's state but not the place nor the answer.
 * The first outcome kept for a delivery stays: one answer per question.
 */
import type { DeliveryId, FleetId, ShipId } from '@aeolus-fleet/common';

/** Where the person acted: Bridge, a chat (an MCP client of the gateway), or Slack; or the gateway, which saw a step of its own complete (CC14). */
export type Place = 'bridge' | 'chat' | 'slack' | 'gateway';

/**
 * What the person did: saw it, answered it (with the option they picked, if
 * any), or marked it done, or a step that they cannot do it; saw a question its asker withdrew or replaced; or
 * removed an answer from the basket the fleet refused, so it was not sent.
 */
export type OutcomeKind = 'seen' | 'answered' | 'done' | 'cannot' | 'withdrawn' | 'replaced' | 'notSent';

export interface ItemOutcome {
  readonly fleetId: FleetId;
  readonly shipId: ShipId;
  readonly deliveryId: DeliveryId;
  readonly place: Place;
  readonly kind: OutcomeKind;
  /** The option of a question the person answered with; none for a note alone or any other outcome. */
  readonly option: number | null;
  /** The note the person sent with it: an answer's or a step outcome's; none when they wrote none. */
  readonly note: string | null;
  /** Where and when the person first saw the item, so Done tells its history; none where the gateway did not see it seen. */
  readonly seen: Sighting | null;
  readonly at: Date;
}

/** Where and when the person saw an item. */
export interface Sighting {
  readonly place: Place;
  readonly at: Date;
}

/** An outcome to keep: its note and where it was seen, when the place it came from knows them. */
export type NewItemOutcome = Omit<ItemOutcome, 'note' | 'seen'> & { readonly note?: string | null; readonly seen?: Sighting | null };

/** Outbound port: the outcomes kept, by fleet, person ship and delivery. */
export interface ItemOutcomes {
  /**
   * Keeps it, unless an outcome of the delivery is kept already: one answer
   * per question. An item kept as seen is the one exception: what came of it
   * after takes its place, still saying where and when it was seen. An
   * outcome of seen was seen where and when it was kept.
   */
  save(outcome: NewItemOutcome): Promise<void>;
  /** The outcomes of these deliveries of the person ship that are kept. */
  findMany(fleetId: FleetId, asked: { shipId: ShipId; deliveryIds: readonly DeliveryId[] }): Promise<ItemOutcome[]>;
}

const PLACES: Record<Place, string> = {
  bridge: 'in Bridge',
  chat: 'in a chat',
  slack: 'in Slack',
  gateway: 'by the gateway',
};

const KINDS: Record<OutcomeKind, string> = {
  seen: 'Seen',
  answered: 'Answered',
  done: 'Done',
  cannot: 'Marked cannot',
  withdrawn: 'Withdrawn by its asker, seen',
  replaced: 'Replaced by its asker, seen',
  notSent: 'Not sent, removed',
};

/** What came of an item and where, in words, as Bridge says it: such as Answered in Slack: option 2. */
export function outcomeTextOf(outcome: Pick<ItemOutcome, 'place' | 'kind' | 'option'>): string {
  const said = `${KINDS[outcome.kind]} ${PLACES[outcome.place]}`;
  return outcome.option === null ? said : `${said}: option ${String(outcome.option)}`;
}
