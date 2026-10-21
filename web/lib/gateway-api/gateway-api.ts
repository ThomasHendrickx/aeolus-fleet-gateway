/**
 * The web app's server calling the gateway's API (header design part 5,
 * decision 0033): one tRPC client per page request, as the browser that
 * asked, by its shared sign-in forwarded, in the fleet its page names. Server
 * only: a browser never calls the API from a page.
 */
import { FLEET_HEADER } from '@aeolus-fleet/common';
import { createTRPCClient, httpLink, type TRPCClient } from '@trpc/client';

import type { GatewayRouter } from '../../../src/adapters/trpc/router.js';

/** The gateway's API, as the web app's server calls it. */
export type GatewayApi = TRPCClient<GatewayRouter>;

/** The shared account sign-in's cookie (header design H5): src/core/account-sign-in/ports.ts names the same. */
const SHARED_SIGN_IN_COOKIE = 'aeolus_account_session';

/**
 * The browser's cookies the API is sent: the shared sign-in alone. The API
 * would take the gateway's old page session or argo's console session first,
 * as another account or fleet than the page shows.
 */
export function forwardedCookieOf(header: string | undefined): string | undefined {
  const prefix = `${SHARED_SIGN_IN_COOKIE}=`;
  const signIn = header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix) && part.length > prefix.length);
  return signIn;
}

/** The header the waiting page sends its browser's secret in, so it never travels in an address (src/adapters/trpc/router.ts names the same). */
const WAITING_SECRET_HEADER = 'aeolus-waiting-secret';

/** What a call of the API is sent besides its input: the shared sign-in, the fleet the page names, and the waiting page's browser secret. */
export interface ApiSent {
  cookie: string | undefined;
  fleetId: string | undefined;
  waitingSecret?: string;
}

export function apiHeadersOf(sent: ApiSent): Record<string, string> {
  const cookie = forwardedCookieOf(sent.cookie);
  return {
    ...(cookie === undefined ? {} : { cookie }),
    ...(sent.fleetId === undefined ? {} : { [FLEET_HEADER]: sent.fleetId }),
    ...(sent.waitingSecret === undefined ? {} : { [WAITING_SECRET_HEADER]: sent.waitingSecret }),
  };
}

export function gatewayApi(sent: ApiSent & { url: string }): GatewayApi {
  return createTRPCClient<GatewayRouter>({ links: [httpLink({ url: `${sent.url}/trpc`, headers: apiHeadersOf(sent) })] });
}
