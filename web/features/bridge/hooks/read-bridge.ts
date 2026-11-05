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
import { readFleetAlertCount } from '../fleet/hooks/read-fleet-alert-count';
import { refusalCodeOf } from '../../../lib/gateway-api/page-api';
import type { ArgoInboxNotice } from '../services/argo-inbox-notice';
import type { ArgoSection } from '../services/argo-section';
import type { WhoDidNotAnswer } from '../ui/unreadable-banner';
import type { WakeChannels } from '../services/deliveries';
import type { BasketView } from '../services/basket';
import type { BridgeHome, RecordPage } from '../services/items';
import type { ShownRequest } from '../services/requests';
import { decidePlacesOf, waitingByJobOf, type RoutedPlace, type RoutingView, type WaitingByJob } from '../services/routing';
import { shellCountsOf, type ShellCounts } from '../services/shell';

/** What waits of each job while Bridge home cannot be read: no count is said. */
const NOTHING_KNOWN_WAITING: WaitingByJob = { decide: undefined, do: undefined, 'stay-aware': undefined, 'everything-else': undefined };

/**
 * What Bridge read of the person ship: what it answered; none, for an account
 * with no person ship, on which nothing waits; or that the record cannot be
 * read now, saying why. Nothing was acknowledged then, so nothing is lost.
 */
export type BridgeRead<T> = { kind: 'read'; value: T } | { kind: 'none' } | { kind: 'unreadable'; whoDidNotAnswer: WhoDidNotAnswer };

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

/** Why Slack shows the person nothing now, as the gateway answers it: the fleet's own bot, by its name, was removed in Slack. */
export type SlackDroppedOut = NonNullable<Awaited<ReturnType<GatewayApi['slack']['droppedOut']['query']>>>;

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

/** When a part was read, now, for the browser to keep it as last read; none while the record cannot be read. */
export function readTimeOf(read: BridgeRead<unknown>): string | undefined {
  return read.kind === 'unreadable' ? undefined : new Date().toISOString();
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
    // Core's own words stay out of the page: the banner says it once (states.html).
    return { kind: 'unreadable', whoDidNotAnswer: code === undefined ? 'gateway' : 'fleet' };
  }
}

/** Bridge home, read once per page: the shell's counts and home's lists share the read. */
export const readBridgeHome = cache((api: GatewayApi): Promise<BridgeRead<BridgeHome>> => personRead(api.people.home.query()));

/** Bridge home's notice of argo's read rule; none while the gateway does not answer it, as home shows without it. */
export async function readArgoInboxNotice(api: GatewayApi): Promise<ArgoInboxNotice> {
  try {
    return await api.people.argoInboxNotice.query();
  } catch {
    return { kind: 'none' };
  }
}

/** Bridge's argo section, read once per page: the shell's count and home's section share the read. None for an account not allowed as argo, or while the gateway does not answer it, as Bridge shows without it. */
export const readArgoSection = cache(async (api: GatewayApi): Promise<ArgoSection | null> => {
  try {
    return await api.people.argoSection.query();
  } catch {
    return null;
  }
});


/**
 * Why Slack shows the person nothing now, if it dropped out (Bridge, section
 * 9): null while it did not, or for an account the API refuses it to;
 * undefined while it cannot be read now, so Bridge goes on saying what it
 * last read. The person's own reads say whether their sign-in ended.
 */
export async function readSlackDroppedOut(api: GatewayApi): Promise<SlackDroppedOut | null | undefined> {
  try {
    return await api.slack.droppedOut.query();
  } catch (error) {
    return refusalCodeOf(error) === 'FORBIDDEN' ? null : undefined;
  }
}

/** The places besides Bridge that show a question, for an opened question to name; none while routing cannot be read, as the question shows without them. */
export async function readDecidePlaces(api: GatewayApi): Promise<RoutedPlace[] | undefined> {
  try {
    return decidePlacesOf(await api.people.routing.query());
  } catch {
    return undefined;
  }
}

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
 * to stay aware of, from Bridge home's read, the basket's answers, the
 * ships with an alert, the number the fleet counts, and what waits at argo. A count it cannot read now is
 * left out.
 */
export async function readShellCounts(api: GatewayApi): Promise<ShellCounts> {
  const [home, basket, fleet, argo] = await Promise.all([readBridgeHome(api), readBasketCount(api), readFleetAlertCount(api), readArgoSection(api)]);
  return shellCountsOf({ home, basket, fleetAlerts: fleet, argo: argo?.count });
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
