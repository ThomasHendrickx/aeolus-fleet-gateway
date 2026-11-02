/**
 * Your fleet as Bridge shows it (Bridge home, as Harbour draws it,
 * docs/design/fleet-overview): each state's word and tone, each group's
 * name, and Harbour's lead line. Pure view logic, no React and no API client.
 */
import type { inferRouterOutputs } from '@trpc/server';

import type { GatewayRouter } from '../../../../../src/adapters/trpc/router.js';

/** Your fleet as the API answers it: the ship count, how many are in each state, and the tiles by group. */
export type YourFleet = inferRouterOutputs<GatewayRouter>['people']['yourFleet'];

export type FleetGroup = YourFleet['groups'][number]['group'];

export type ShipState = keyof YourFleet['counts'];

export type FleetTile = YourFleet['groups'][number]['tiles'][number];

/** The states in the order the numbers show them. */
export const SHIP_STATES: readonly ShipState[] = ['alert', 'waiting', 'working', 'idle'];

export const STATE_LABELS: Record<ShipState, string> = { alert: 'Alert', waiting: 'Waiting', working: 'Working', idle: 'Idle' };

export const GROUP_LABELS: Record<FleetGroup, string> = { people: 'People', agents: 'Agents', plugins: 'Plugins', throughTheGateway: 'Through the gateway' };

/** Harbour's lead line words each state so; working and idle first, as most ships are. */
const SUMMARY_PARTS: readonly { state: ShipState; words: string }[] = [
  { state: 'working', words: 'working' },
  { state: 'idle', words: 'idle' },
  { state: 'waiting', words: 'waiting' },
  { state: 'alert', words: 'with an alert' },
];

/** How many ships, in words: "1 ship", "15 ships". */
export function shipsOf(count: number): string {
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** When a ship last did something, in the words of Your fleet's tiles (design/bridge-fleet-width): now, 25 min, 3 h, yesterday, 2 d up to 6 d, then the date (28 Oct); "No activity yet" while it did nothing. */
export function ageOf(lastActivityAt: string | null, now: Date): string {
  if (lastActivityAt === null) {
    return 'No activity yet';
  }
  const at = new Date(lastActivityAt);
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) {
    return 'now';
  }
  if (minutes < 60) {
    return `${String(minutes)} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${String(hours)} h`;
  }
  const days = Math.floor(hours / 24);
  if (days < 2) {
    return 'yesterday';
  }
  return days < 7 ? `${String(days)} d` : `${String(at.getDate())} ${MONTHS[at.getMonth()] ?? ''}`;
}
