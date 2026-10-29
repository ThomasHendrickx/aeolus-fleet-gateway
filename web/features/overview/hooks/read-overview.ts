/**
 * What the Overview shows, read through the gateway's API as the signed-in
 * account (design B, Signal; decision 0056): what waits on their person
 * ship and the channels that wake them, the requests to decide for an
 * approver, the requests they asked, and their Slack link.
 * A part the API refuses the account (FORBIDDEN) is not theirs to see, so it
 * is left out; any other refusal fails the page.
 */
import type { GatewayApi } from '../../../lib/gateway-api/gateway-api';
import { refusalCodeOf } from '../../../lib/gateway-api/page-api';
import type { Inbox, WakeChannels } from '../services/deliveries';
import type { ShownRequest } from '../services/requests';

export const OVERVIEW_PATH = '/overview';

export interface OverviewParts {
  readonly inbox: Inbox | undefined;
  /** The channels that wake the person when something waits for their person ship (wake a person, W8). */
  readonly wakeChannels: WakeChannels | undefined;
  readonly toDecide: readonly ShownRequest[] | undefined;
  readonly mine: readonly ShownRequest[] | undefined;
  /** The person's Slack link (gateway scopes 9.6); none while the fleet's own bot is not in Slack. */
  readonly slackLink: SlackLink | null | undefined;
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

export async function readOverview(api: GatewayApi): Promise<OverviewParts> {
  const [inbox, wakeChannels, toDecide, mine, slackLink] = await Promise.all([
    unlessForbidden(api.people.inbox.query()),
    unlessForbidden(api.people.wakeChannels.query()),
    unlessForbidden(api.requests.toDecide.query()),
    unlessForbidden(api.requests.mine.query()),
    unlessForbidden(api.slack.link.query()),
  ]);
  return { inbox, wakeChannels, toDecide, mine, slackLink };
}

/** One request to decide, undefined once it no longer waits, and the queue beside it. */
export async function readRequestToDecide(api: GatewayApi, requestId: string): Promise<{ request: ShownRequest | undefined; toDecide: readonly ShownRequest[] }> {
  const toDecide = (await unlessForbidden(api.requests.toDecide.query())) ?? [];
  return { request: toDecide.find((open) => open.requestId === requestId), toDecide };
}
