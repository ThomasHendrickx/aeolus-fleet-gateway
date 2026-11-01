/**
 * What Bridge's pages show, read through the gateway's API as the signed-in
 * account (docs/design/bridge; decision 0056): Bridge home, a page of the
 * record for Done, and Bridge's settings: the channels that wake the person,
 * the requests to decide for an approver, the requests they asked, and their
 * Slack link. A part the API refuses the account (FORBIDDEN) is not theirs to
 * see, so it is left out.
 */
import type { GatewayApi } from '../../../lib/gateway-api/gateway-api';
import { refusalCodeOf, refusalMessageOf } from '../../../lib/gateway-api/page-api';
import type { WakeChannels } from '../services/deliveries';
import type { BridgeHome, RecordPage } from '../services/items';
import type { ShownRequest } from '../services/requests';

/**
 * What Bridge read of the person ship: what it answered; none, for an account
 * with no person ship, on which nothing waits; or that the record cannot be
 * read now, saying why. Nothing was acknowledged then, so nothing is lost.
 */
export type BridgeRead<T> = { kind: 'read'; value: T } | { kind: 'none' } | { kind: 'unreadable'; message: string };

export interface BridgeSettingsParts {
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

export function readBridgeHome(api: GatewayApi): Promise<BridgeRead<BridgeHome>> {
  return personRead(api.people.home.query());
}

export function readRecordPage(api: GatewayApi, cursor: string | null): Promise<BridgeRead<RecordPage>> {
  return personRead(api.people.record.query({ cursor }));
}

export async function readBridgeSettings(api: GatewayApi): Promise<BridgeSettingsParts> {
  const [wakeChannels, toDecide, mine, slackLink] = await Promise.all([
    unlessForbidden(api.people.wakeChannels.query()),
    unlessForbidden(api.requests.toDecide.query()),
    unlessForbidden(api.requests.mine.query()),
    unlessForbidden(api.slack.link.query()),
  ]);
  return { wakeChannels, toDecide, mine, slackLink };
}

/** One request to decide, undefined once it no longer waits, and the queue beside it. */
export async function readRequestToDecide(api: GatewayApi, requestId: string): Promise<{ request: ShownRequest | undefined; toDecide: readonly ShownRequest[] }> {
  const toDecide = (await unlessForbidden(api.requests.toDecide.query())) ?? [];
  return { request: toDecide.find((open) => open.requestId === requestId), toDecide };
}
