import { Suspense } from 'react';

import type { GatewayApi } from '../../../lib/gateway-api/gateway-api';
import { signedInPage, type SearchParams } from '../../../lib/gateway-api/page-api';
import { NoSignIn } from '../../sign-in/ui/no-sign-in';
import { BRIDGE_SETTINGS_PATH, readBridgeSettings } from '../hooks/read-bridge';
import { slackLinkOutcomeOf } from '../services/slack-link-outcomes';
import { BridgeNav } from '../ui/bridge-nav';
import { BridgeSkeleton } from '../ui/bridge-skeleton';
import { Notice } from '../ui/notice';
import { RequestsList } from '../ui/requests-list';
import { LiveRefresh } from './live-refresh';
import { SlackLinkPanel } from './slack-link-panel';
import { WakePanel } from './wake-panel';

/** What a decision the person just made came to, said once they are back. */
const DECIDED: Record<string, string> = {
  approve: 'You approved the request.',
  deny: 'You denied the request.',
};

async function SettingsParts({ api, fleetId }: { api: GatewayApi; fleetId: string }) {
  const { wakeChannels, toDecide, mine, slackLink } = await readBridgeSettings(api);
  const now = new Date();
  return (
    <>
      {wakeChannels === undefined ? null : <WakePanel fleetId={fleetId} channels={wakeChannels} />}
      {slackLink === undefined || slackLink === null ? null : <SlackLinkPanel fleetId={fleetId} slackLink={slackLink} />}
      {toDecide === undefined ? null : toDecide.length === 0 ? (
        <p className="text-muted-foreground">No request waits for a decision.</p>
      ) : (
        <RequestsList title="To decide" requests={toDecide} now={now} hrefOf={(request) => `${BRIDGE_SETTINGS_PATH}/requests/${encodeURIComponent(request.requestId)}?fleet=${encodeURIComponent(fleetId)}`} />
      )}
      {mine === undefined || mine.length === 0 ? null : <RequestsList title="Your requests" requests={mine} now={now} />}
    </>
  );
}

/**
 * Bridge's settings (CC18): what the Overview held beside its inbox. The
 * channels that wake the person, their Slack link, the requests to decide
 * for an approver, oldest first, and the requests they asked. Signed out,
 * the browser goes to sign in before anything shows; it reads itself again
 * whenever the fleet's requests change.
 */
export async function BridgeSettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const page = await signedInPage({ path: BRIDGE_SETTINGS_PATH, searchParams });
  if (page.kind === 'noSignIn') {
    return <NoSignIn />;
  }
  const { decided } = searchParams;
  const said = typeof decided === 'string' ? DECIDED[decided] : undefined;
  const linked = slackLinkOutcomeOf(searchParams);
  return (
    <div className="grid gap-6">
      <LiveRefresh fleetId={page.fleetId} />
      <BridgeNav fleetId={page.fleetId} current="settings" />
      <h1 className="text-heading font-semibold">Settings</h1>
      {said === undefined ? null : <Notice message={said} isFailure={false} />}
      {linked === undefined ? null : <Notice message={linked.message} isFailure={linked.isFailure} />}
      <Suspense fallback={<BridgeSkeleton />}>
        <SettingsParts api={page.api} fleetId={page.fleetId} />
      </Suspense>
    </div>
  );
}
