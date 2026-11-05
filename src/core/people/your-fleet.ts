/**
 * Your fleet (Bridge home, as Harbour draws it, docs/design/fleet-overview):
 * every active ship the person reads, each in one of five states
 * (docs/design/state-colours) and one
 * group by its kind, with the numbers on top. The state and the group come
 * only from what core answers of the ship in Harbour: its state, its crew's
 * note, when it last did something and its kind (decision 0044).
 */
import type { ShipId, ShipKind } from '@aeolus-fleet/common';

/** An active ship as the fleet lists it to the person: retired ships are not listed. */
export interface ListedShip {
  readonly shipId: ShipId;
  readonly name: string;
  readonly kind: ShipKind;
  /** The state core worded for the ship (Harbour): an alert, awaiting crew, blocked, working or idle. */
  readonly state: ShipState;
  /** What its crew last said it is doing; null when it said nothing. */
  readonly note: string | null;
  /** When the ship last did something, as an ISO time; null while it did nothing yet. */
  readonly lastActivityAt: string | null;
}

/** The five states, in the order a group shows them: what needs the person first. */
export const SHIP_STATES = ['alert', 'awaitingCrew', 'blocked', 'working', 'idle'] as const;
export type ShipState = (typeof SHIP_STATES)[number];

/** The groups, in the order Your fleet shows them. */
export const FLEET_GROUPS = ['people', 'agents', 'plugins', 'throughTheGateway'] as const;
export type FleetGroup = (typeof FLEET_GROUPS)[number];

export interface FleetTile {
  readonly shipId: ShipId;
  readonly name: string;
  readonly state: ShipState;
  /** What the ship is doing, as its crew last said; null when it said nothing. */
  readonly note: string | null;
  /** When the ship last did something, as an ISO time; null while it did nothing yet. */
  readonly lastActivityAt: string | null;
}

export interface YourFleet {
  readonly shipCount: number;
  readonly counts: Readonly<Record<ShipState, number>>;
  /** Only the groups that hold a ship. */
  readonly groups: readonly { readonly group: FleetGroup; readonly tiles: readonly FleetTile[] }[];
}

/** The group of a ship by its kind; the viewer, the console's door, is in none. */
function groupOf(kind: ShipKind): FleetGroup | null {
  switch (kind) {
    case 'operator':
    case 'person':
      return 'people';
    case 'agent':
      return 'agents';
    case 'plugin':
      return 'plugins';
    case 'app':
      return 'throughTheGateway';
    case 'viewer':
      return null;
  }
}

/** The newest last activity first; a ship that never did anything after every ship that did. */
function byLastActivity(left: FleetTile, right: FleetTile): number {
  if (left.lastActivityAt === right.lastActivityAt) {
    return 0;
  }
  if (left.lastActivityAt === null || right.lastActivityAt === null) {
    return left.lastActivityAt === null ? 1 : -1;
  }
  return Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt);
}

/** Inside a group: by state, then the newest last activity first, then by name (Thomas, aeolus-fleet#1605). */
function inGroupOrder(left: FleetTile, right: FleetTile): number {
  return SHIP_STATES.indexOf(left.state) - SHIP_STATES.indexOf(right.state) || byLastActivity(left, right) || left.name.localeCompare(right.name);
}

export function yourFleetOf(ships: readonly ListedShip[]): YourFleet {
  const placed = ships.flatMap((ship) => {
    const group = groupOf(ship.kind);
    return group === null ? [] : [{ group, tile: { shipId: ship.shipId, name: ship.name, state: ship.state, note: ship.note, lastActivityAt: ship.lastActivityAt } }];
  });
  // The numbers are core's, which counts the viewer too: the sidebar's alert count reads the same number from core.
  const counts = { alert: 0, awaitingCrew: 0, blocked: 0, working: 0, idle: 0 };
  for (const { state } of ships) {
    counts[state] += 1;
  }
  const groups = FLEET_GROUPS.map((group) => ({
    group,
    tiles: placed
      .filter((each) => each.group === group)
      .map(({ tile }) => tile)
      .toSorted(inGroupOrder),
  })).filter(({ tiles }) => tiles.length > 0);
  return { shipCount: placed.length, counts, groups };
}
