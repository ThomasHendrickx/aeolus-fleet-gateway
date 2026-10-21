/**
 * The Overview's live updates for the browser: the web app's server follows
 * the API's stream of the fleet's request changes as the browser that asked,
 * by its cookies, and passes each on. A change carries nothing of what
 * changed; the page reads itself again.
 */
import { FLEET_HEADER } from '@aeolus-fleet/common';

import { FLEET_PARAMETER } from '../../../lib/gateway-api/page-account';
import { apiUrl } from '../../../lib/gateway-api/page-api';

export async function followChanges(request: Request): Promise<Response> {
  const fleet = new URL(request.url).searchParams.get(FLEET_PARAMETER);
  const cookie = request.headers.get('cookie');
  const upstream = await fetch(`${apiUrl()}/trpc/requests.changes`, {
    headers: { accept: 'text/event-stream', ...(cookie === null ? {} : { cookie }), ...(fleet === null ? {} : { [FLEET_HEADER]: fleet }) },
    signal: request.signal,
  });
  return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': upstream.headers.get('content-type') ?? 'text/event-stream', 'cache-control': 'no-store' } });
}
