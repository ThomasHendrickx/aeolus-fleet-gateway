/**
 * What came of an item and where (docs/design/bridge, CC4): the gateway
 * keeps it when the person acts on a delivery to their person ship, since
 * core's record keeps the delivery's state but not the place nor the answer.
 * The first outcome kept for a delivery stays: one answer per question.
 */
import type { DeliveryId, FleetId, ShipId } from '@aeolus-fleet/common';

/** Where the person acted: Bridge, a chat (an MCP client of the gateway), or Slack. */
export type Place = 'bridge' | 'chat' | 'slack';

/** What the person did: saw it, answered it (with the option they picked, if any), or marked it done; or saw a question its asker withdrew or replaced. */
export type OutcomeKind = 'seen' | 'answered' | 'done' | 'withdrawn' | 'replaced';

export interface ItemOutcome {
  readonly fleetId: FleetId;
  readonly shipId: ShipId;
  readonly deliveryId: DeliveryId;
  readonly place: Place;
  readonly kind: OutcomeKind;
  /** The option of a question the person answered with; none for a note alone or any other outcome. */
  readonly option: number | null;
  readonly at: Date;
}

/** Outbound port: the outcomes kept, by fleet, person ship and delivery. */
export interface ItemOutcomes {
  /** Keeps it, unless an outcome of the delivery is kept already. */
  save(outcome: ItemOutcome): Promise<void>;
  /** The outcomes of these deliveries of the person ship that are kept. */
  findMany(fleetId: FleetId, asked: { shipId: ShipId; deliveryIds: readonly DeliveryId[] }): Promise<ItemOutcome[]>;
}
