/**
 * What the authorize pages read through the gateway's API, as the browser
 * that asked: the client an authorization request is for, and a client
 * waiting for approval, by the waiting cookie the browser sent.
 */
import { cookies, headers } from 'next/headers';

import { gatewayApi } from '../../../lib/gateway-api/gateway-api';
import { apiUrl, refusalCodeOf, requestApi } from '../../../lib/gateway-api/page-api';

/** The cookie the gateway's waiting address set: the browser's secret for its request. */
const WAITING_COOKIE = 'aeolus_waiting';

const FAILED_PAGE = '/authorize/failed';

export function failedPage(reason: string): string {
  return `${FAILED_PAGE}?${new URLSearchParams({ reason }).toString()}`;
}

/** The client a request is for; a request the gateway would not serve, or a gateway that signs no one in, fails. */
export async function readClient(fields: readonly [string, string][]): Promise<{ kind: 'client'; client: { clientId: string; clientName: string; redirectUri: string } } | { kind: 'failed'; reason: 'invalidClient' | 'noSignIn' }> {
  const api = await requestApi(undefined);
  try {
    return { kind: 'client', client: await api.oauth.authorization.query(Object.fromEntries(fields)) };
  } catch (error) {
    const code = refusalCodeOf(error);
    if (code === 'BAD_REQUEST') {
      return { kind: 'failed', reason: 'invalidClient' };
    }
    if (code === 'NOT_FOUND') {
      return { kind: 'failed', reason: 'noSignIn' };
    }
    throw error;
  }
}

/** A client waiting for approval, or goOn once its request no longer waits. */
export async function readWaiting(waiting: string): Promise<{ kind: 'waiting'; clientName: string; expiresAt: string } | { kind: 'goOn' }> {
  const browserSecret = (await cookies()).get(WAITING_COOKIE)?.value;
  // The secret goes beside the call, never in its input, which travels in the address the gateway logs.
  const api = gatewayApi({ url: apiUrl(), cookie: (await headers()).get('cookie') ?? undefined, fleetId: undefined, ...(browserSecret === undefined ? {} : { waitingSecret: browserSecret }) });
  return api.oauth.waiting.query({ waiting });
}
