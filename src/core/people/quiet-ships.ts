/**
 * Quiet ships (preferences design): per fleet and person ship, the ships
 * the person quieted. A quiet ship never wakes the person, through web push
 * or email, for any job; Slack and a chat are places, not wakes, so their
 * per job switches stand. Every item still waits whatever is chosen. A ship
 * woken again is kept so, with when, as it wakes only for what it sends
 * after. Kept by ship id, so a rename stays quiet and a reused name does
 * not inherit it; the name is the one it had when quieted.
 */
import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { PersonShip } from './ports.js';
import type { RoutedItem, Routing, RoutingPlace } from './routing.js';

/** A ship a person quieted, or woke again, with when they did. */
export interface QuietShip {
  readonly fleetId: FleetId;
  readonly shipId: ShipId;
  readonly quietShipId: ShipId;
  readonly name: string;
  readonly isQuiet: boolean;
  readonly changedAt: Date;
}

/** A page of the person's quiet ships, the latest quieted first, and the cursor of the next; null on the last. */
export interface QuietShipsPage {
  readonly ships: readonly QuietShip[];
  readonly nextCursor: ShipId | null;
}

/** Outbound port: each person's quiet ships, by fleet and person ship. */
export interface QuietShips {
  /** What the person chose for any of these ships: quiet, or woken again. */
  among(ship: PersonShip, shipIds: readonly ShipId[]): Promise<QuietShip[]>;
  /** The quiet ones only, the latest quieted first, after the cursor. */
  listQuiet(ship: PersonShip, page: { cursor: ShipId | null; limit: number }): Promise<QuietShipsPage>;
  /** Keeps it, or keeps it anew for its ship. */
  save(quietShip: QuietShip): Promise<void>;
}

/** Whether the place wakes the person, so a quiet ship keeps out of it. */
function isWakePlace(place: RoutingPlace): boolean {
  switch (place) {
    case 'web-push':
    case 'email':
      return true;
    case 'slack':
    case 'chat':
      return false;
  }
}

/** Routing with the person's quiet ships: none of them wakes, and one woken again wakes for what it sent since. */
export function withQuietShips(routing: Routing, quietShips: readonly QuietShip[]): Routing {
  const chosen = new Map(quietShips.map((quietShip) => [quietShip.quietShipId, quietShip]));
  const isQuietFor = ({ senderShipId, sentAt }: RoutedItem): boolean => {
    const quietShip = chosen.get(senderShipId);
    return quietShip !== undefined && (quietShip.isQuiet || sentAt.getTime() < quietShip.changedAt.getTime());
  };
  return {
    isOn: (job, place) => routing.isOn(job, place),
    isShowing: (place, item) => !(isWakePlace(place) && isQuietFor(item)) && routing.isShowing(place, item),
  };
}
