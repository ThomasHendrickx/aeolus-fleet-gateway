/**
 * The Overview's live updates for the browser: the web app's server follows
 * the API's stream of the fleet's request changes as the browser that asked,
 * by its shared sign-in alone, and passes each on. A change carries nothing
 * of what changed; the page reads itself again.
 */
import { FLEET_HEADER } from '@aeolus-fleet/common';

import { forwardedCookieOf } from '../../../lib/gateway-api/gateway-api';
import { FLEET_PARAMETER } from '../../../lib/gateway-api/page-account';
import { apiUrl } from '../../../lib/gateway-api/page-api';

/** What the call to the API's stream carries: the shared sign-in alone, as every call of the web app's server, and the fleet the page names. */
export function upstreamHeadersOf(request: Request): Record<string, string> {
  const fleet = new URL(request.url).searchParams.get(FLEET_PARAMETER);
  const cookie = forwardedCookieOf(request.headers.get('cookie') ?? undefined);
  return { accept: 'text/event-stream', ...(cookie === undefined ? {} : { cookie }), ...(fleet === null ? {} : { [FLEET_HEADER]: fleet }) };
}

export async function followChanges(request: Request): Promise<Response> {
  const upstream = await fetch(`${apiUrl()}/trpc/requests.changes`, { headers: upstreamHeadersOf(request), signal: request.signal });
  return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': upstream.headers.get('content-type') ?? 'text/event-stream', 'cache-control': 'no-store' } });
}
