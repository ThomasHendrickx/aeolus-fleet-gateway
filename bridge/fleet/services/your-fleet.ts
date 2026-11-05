/**
 * Your fleet as Bridge shows it: Harbour from @aeolus-fleet/ui draws it
 * (aeolus-fleet docs/design/fleet-overview), each ship in one of the five
 * states (docs/design/state-colours). Here: what Harbour takes of the read,
 * each state's word and Harbour's lead line. Pure view logic, no React and
 * no API client.
 */
import type { HarbourCounts, HarbourGroupKind, HarbourGroupShips } from '@aeolus-fleet/ui';

import type { GatewayApi } from '../../../web/lib/gateway-api/gateway-api';

/** Your fleet as the API answers it: the ship count, how many are in each state, and the tiles by group. */
export type YourFleet = Awaited<ReturnType<GatewayApi['people']['yourFleet']['query']>>;

export type FleetGroup = YourFleet['groups'][number]['group'];

export type ShipState = keyof YourFleet['counts'];

/** The states in the order Harbour shows them, what needs the person first. */
export const SHIP_STATES: readonly ShipState[] = ['alert', 'awaitingCrew', 'blocked', 'working', 'idle'];

export const STATE_LABELS: Record<ShipState, string> = { alert: 'Alert', awaitingCrew: 'Awaiting crew', blocked: 'Blocked', working: 'Working', idle: 'Idle' };

/** Each group as Harbour names its kind. */
const HARBOUR_KINDS: Record<FleetGroup, HarbourGroupKind> = { people: 'people', agents: 'agents', plugins: 'plugins', throughTheGateway: 'gateway' };

/** Harbour's lead line words each state so; working and idle first, as most ships are. */
const SUMMARY_PARTS: readonly { state: ShipState; words: string }[] = [
  { state: 'working', words: 'working' },
  { state: 'idle', words: 'idle' },
  { state: 'awaitingCrew', words: 'awaiting crew' },
  { state: 'blocked', words: 'blocked' },
  { state: 'alert', words: 'with an alert' },
];

/** How many ships, in words: "1 ship", "15 ships". */
function shipsOf(count: number): string {
  return `${String(count)} ${count === 1 ? 'ship' : 'ships'}`;
}

/** Harbour's lead line: the ships, then how many are in each state any ship is in. */
export function summaryOf(fleet: YourFleet): string {
  if (fleet.shipCount === 0) {
    return 'No ships';
  }
  const parts = SUMMARY_PARTS.filter(({ state }) => fleet.counts[state] > 0).map(({ state, words }) => `${String(fleet.counts[state])} ${words}`);
  return `${shipsOf(fleet.shipCount)}: ${parts.join(', ')}`;
}

/** Your fleet as Harbour takes it: the numbers, the ships first, and each group's tiles in the order Your fleet gives. */
export function harbourOf(fleet: YourFleet): { counts: HarbourCounts; groups: HarbourGroupShips[] } {
  return {
    counts: { ships: fleet.shipCount, ...fleet.counts },
    groups: fleet.groups.map(({ group, tiles }) => ({ kind: HARBOUR_KINDS[group], tiles: tiles.map(({ shipId, ...tile }) => ({ id: shipId, ...tile })) })),
  };
}
