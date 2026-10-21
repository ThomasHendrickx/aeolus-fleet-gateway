/**
 * The web app's server calling the gateway's API (header design part 5,
 * decision 0033): one tRPC client per page request, as the browser that
 * asked, by its cookies forwarded, in the fleet its page names. Server
 * only: a browser never calls the API from a page.
 */
import { FLEET_HEADER } from '@aeolus-fleet/common';
import { createTRPCClient, httpLink, type TRPCClient } from '@trpc/client';

import type { GatewayRouter } from '../../../src/adapters/trpc/router.js';

/** The gateway's API, as the web app's server calls it. */
export type GatewayApi = TRPCClient<GatewayRouter>;

export function gatewayApi(sent: { url: string; cookie: string | undefined; fleetId: string | undefined }): GatewayApi {
  const headers: Record<string, string> = {
    ...(sent.cookie === undefined ? {} : { cookie: sent.cookie }),
    ...(sent.fleetId === undefined ? {} : { [FLEET_HEADER]: sent.fleetId }),
  };
  return createTRPCClient<GatewayRouter>({ links: [httpLink({ url: `${sent.url}/trpc`, headers })] });
}
