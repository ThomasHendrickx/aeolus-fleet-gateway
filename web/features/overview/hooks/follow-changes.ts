/**
 * The Overview's live streams for the browser: the web app's server follows
 * the API's stream as the browser that asked, by its shared sign-in alone,
 * and passes each event on. The changes stream tells the page to read
 * itself again, carrying nothing of what changed; the focus stream is held
 * open while the page is in focus (wake a person, W6), and ends with the
 * browser's request.
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

async function follow(request: Request, procedure: string): Promise<Response> {
  const upstream = await fetch(`${apiUrl()}/trpc/${procedure}`, { headers: upstreamHeadersOf(request), signal: request.signal });
  return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': upstream.headers.get('content-type') ?? 'text/event-stream', 'cache-control': 'no-store' } });
}

export function followChanges(request: Request): Promise<Response> {
  return follow(request, 'requests.changes');
}

/** Holds the page in focus at the gateway for as long as the browser holds this stream open. */
export function followFocus(request: Request): Promise<Response> {
  return follow(request, 'people.focus');
}
