/**
 * Link Slack (gateway scopes 9.3), from the Overview or the button in the
 * answer a bot gave an unlinked person in Slack: as the account signed in,
 * the gateway opens Sign in with Slack and the browser goes there. Signed
 * out, it goes to pagasae's sign-in first and comes back here; a refusal
 * goes to the Overview, which says why by its outcome.
 */
import { redirect } from 'next/navigation';

import { FLEET_PARAMETER } from '../../../lib/gateway-api/page-account';
import { refusalCodeOf, requestApi } from '../../../lib/gateway-api/page-api';
import { OVERVIEW_PATH } from './read-overview';
import { SLACK_LINK_PATH } from './slack-link-path';

/** What the Overview says of a link that did not start, by the API's refusal. */
const NOT_STARTED: Record<string, string> = { FORBIDDEN: 'no-person-ship', NOT_FOUND: 'not-connected' };

export async function startSlackLink(request: Request): Promise<never> {
  const fleet = new URL(request.url).searchParams.get(FLEET_PARAMETER) ?? undefined;
  const inFleet = (said: Record<string, string>) => new URLSearchParams({ ...(fleet === undefined ? {} : { [FLEET_PARAMETER]: fleet }), ...said }).toString();
  let url: string;
  try {
    ({ url } = await (await requestApi(fleet)).slack.startLink.mutate());
  } catch (error) {
    const code = refusalCodeOf(error);
    if (code === 'UNAUTHORIZED') {
      return redirect(`/sign-in/start?${new URLSearchParams({ return_to: `${SLACK_LINK_PATH}?${inFleet({})}` }).toString()}`);
    }
    return redirect(`${OVERVIEW_PATH}?${inFleet({ slack: (code === undefined ? undefined : NOT_STARTED[code]) ?? 'not-started' })}`);
  }
  return redirect(url);
}
