/**
 * What Bridge's pages show, read through the gateway's API as the signed-in
 * account (docs/design/bridge; decision 0056): Bridge home, a page of the
 * record for Done, Bridge's settings: the requests to decide for an
 * approver and the requests they asked, and where things show: each job's
 * places, the channels that wake the person and their Slack link. A part the
 * API refuses the account (FORBIDDEN) is not theirs to see, so it is left
 * out.
 */
import { cache } from 'react';

import type { GatewayApi } from '../../../lib/gateway-api/gateway-api';
import { readYourFleet } from '../fleet/hooks/read-your-fleet';
import { refusalCodeOf, refusalMessageOf } from '../../../lib/gateway-api/page-api';
import type { WakeChannels } from '../services/deliveries';
import type { BasketView } from '../services/basket';
import type { BridgeHome, RecordPage } from '../services/items';
import type { ShownRequest } from '../services/requests';
import type { ShellCounts } from '../ui/bridge-sidebar';
import { waitingByJobOf, type RoutingView, type WaitingByJob } from '../services/routing';

/** What waits of each job while Bridge home cannot be read: no count is said. */
const NOTHING_KNOWN_WAITING: WaitingByJob = { decide: undefined, do: undefined, 'stay-aware': undefined, 'everything-else': undefined };

/**
 * What Bridge read of the person ship: what it answered; none, for an account
 * with no person ship, on which nothing waits; or that the record cannot be
 * read now, saying why. Nothing was acknowledged then, so nothing is lost.
 */
export type BridgeRead<T> = { kind: 'read'; value: T } | { kind: 'none' } | { kind: 'unreadable'; message: string };

export interface BridgeSettingsParts {
  readonly toDecide: readonly ShownRequest[] | undefined;
  readonly mine: readonly ShownRequest[] | undefined;
}

/** Where things show (Bridge, section 8): each job's places, and the places' own state. */
export interface BridgeRoutingParts {
  readonly routing: RoutingView | undefined;
  /** The channels that can wake the person when something waits for their person ship (wake a person, W8). */
  readonly wakeChannels: WakeChannels | undefined;
  /** The person's Slack link (gateway scopes 9.6); none while the fleet's own bot is not in Slack. */
  readonly slackLink: SlackLink | null | undefined;
  /** The chats connected through the gateway as the person ship, by name. */
  readonly chats: readonly string[];
  /** What already waits of each job, for the toast after a change; none known while Bridge home cannot be read. */
  readonly waitingByJob: WaitingByJob;
}

/** A person's Slack link as the gateway answers it: the workspace, and the Slack name linked, none while unlinked. */
export type SlackLink = NonNullable<Awaited<ReturnType<GatewayApi['slack']['link']['query']>>>;

async function unlessForbidden<T>(call: Promise<T>): Promise<T | undefined> {
  try {
    return await call;
  } catch (error) {
    if (refusalCodeOf(error) === 'FORBIDDEN') {
      return undefined;
    }
    throw error;
  }
}

/** A read of the person ship: a sign-in that ended is thrown on, so the page sends the person to sign in again. */
async function personRead<T>(call: Promise<T>): Promise<BridgeRead<T>> {
  try {
    return { kind: 'read', value: await call };
  } catch (error) {
    const code = refusalCodeOf(error);
    if (code === 'FORBIDDEN') {
      return { kind: 'none' };
    }
    if (code === 'UNAUTHORIZED') {
      throw error;
    }
    return { kind: 'unreadable', message: code === undefined ? 'The gateway did not answer.' : refusalMessageOf(error) };
  }
}

/** Bridge home, read once per page: the shell's counts and home's lists share the read. */
export const readBridgeHome = cache((api: GatewayApi): Promise<BridgeRead<BridgeHome>> => personRead(api.people.home.query()));

export function readBasket(api: GatewayApi): Promise<BridgeRead<BasketView>> {
  return personRead(api.people.basket.query());
}

/** How many answers the basket holds, for the navigation: none for an account with no person ship, or while it cannot be read now. */
export async function readBasketCount(api: GatewayApi): Promise<number> {
  const read = await personRead(api.people.basketCount.query());
  return read.kind === 'read' ? read.value.count : 0;
}

/**
 * The counts Bridge's shell shows on every page: what waits and the unseen
 * to stay aware of, from Bridge home's read, the basket's answers, and the
 * ships with an alert, from Your fleet's read. A count it cannot read now is
 * left out.
 */
export async function readShellCounts(api: GatewayApi): Promise<ShellCounts> {
  const [home, basket, fleet] = await Promise.all([readBridgeHome(api), readBasketCount(api), readYourFleet(api)]);
  const fleetAlerts = fleet.kind === 'read' ? fleet.value.counts.alert : undefined;
  switch (home.kind) {
    case 'read':
      return { waiting: home.value.waiting.count, stayAware: home.value.stayAware.length, basket, fleetAlerts };
    case 'none':
      return { waiting: 0, stayAware: 0, basket, fleetAlerts };
    case 'unreadable':
      return { waiting: undefined, stayAware: undefined, basket, fleetAlerts };
  }
}

export function readRecordPage(api: GatewayApi, cursor: string | null): Promise<BridgeRead<RecordPage>> {
  return personRead(api.people.record.query({ cursor }));
}

export async function readBridgeSettings(api: GatewayApi): Promise<BridgeSettingsParts> {
  const [toDecide, mine] = await Promise.all([unlessForbidden(api.requests.toDecide.query()), unlessForbidden(api.requests.mine.query())]);
  return { toDecide, mine };
}

export async function readBridgeRouting(api: GatewayApi): Promise<BridgeRoutingParts> {
  const [routing, wakeChannels, slackLink, chats, home] = await Promise.all([
    unlessForbidden(api.people.routing.query()),
    unlessForbidden(api.people.wakeChannels.query()),
    unlessForbidden(api.slack.link.query()),
    unlessForbidden(api.people.chats.query()),
    readBridgeHome(api),
  ]);
  const waitingByJob = home.kind === 'read' ? waitingByJobOf({ waiting: home.value.waiting.items, stayAware: home.value.stayAware.length }) : NOTHING_KNOWN_WAITING;
  return { routing, wakeChannels, slackLink, chats: chats?.names ?? [], waitingByJob };
}

/** One request to decide, undefined once it no longer waits, and the queue beside it. */
export async function readRequestToDecide(api: GatewayApi, requestId: string): Promise<{ request: ShownRequest | undefined; toDecide: readonly ShownRequest[] }> {
  const toDecide = (await unlessForbidden(api.requests.toDecide.query())) ?? [];
  return { request: toDecide.find((open) => open.requestId === requestId), toDecide };
}
