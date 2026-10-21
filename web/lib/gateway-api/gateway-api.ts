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

export function gatewayApi(sent: { url: string; cookie: string | undefined; fleetId: string | undefined }): GatewayApi {
  const cookie = forwardedCookieOf(sent.cookie);
  const headers: Record<string, string> = {
    ...(cookie === undefined ? {} : { cookie }),
    ...(sent.fleetId === undefined ? {} : { [FLEET_HEADER]: sent.fleetId }),
  };
  return createTRPCClient<GatewayRouter>({ links: [httpLink({ url: `${sent.url}/trpc`, headers })] });
}
