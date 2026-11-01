import { Suspense } from 'react';

import type { GatewayApi } from '../../../lib/gateway-api/gateway-api';
import { signedInPage, type SearchParams } from '../../../lib/gateway-api/page-api';
import { NoSignIn } from '../../sign-in/ui/no-sign-in';
import { readBasketCount, readBridgeSettings } from '../hooks/read-bridge';
import { inFleet } from '../../../lib/gateway-api/page-account';
import { BRIDGE_ROUTING_PATH, BRIDGE_SETTINGS_PATH } from '../paths';
import { BridgeNav } from '../ui/bridge-nav';
import { BridgeSkeleton } from '../ui/bridge-skeleton';
import { Notice } from '../ui/notice';
import { RequestsList } from '../ui/requests-list';
import { LiveRefresh } from './live-refresh';

/** What a decision the person just made came to, said once they are back. */
const DECIDED: Record<string, string> = {
  approve: 'You approved the request.',
  deny: 'You denied the request.',
};

async function SettingsParts({ api, fleetId }: { api: GatewayApi; fleetId: string }) {
  const { toDecide, mine } = await readBridgeSettings(api);
  const now = new Date();
  return (
    <>
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
 * Bridge's settings (CC18): what the Overview held beside its inbox. Where
 * things show, a page of its own (section 8), the requests to decide for an
 * approver, oldest first, and the requests they asked. Signed out,
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
  return (
    <div className="grid gap-6">
      <LiveRefresh fleetId={page.fleetId} />
      <BridgeNav fleetId={page.fleetId} current="settings" basketCount={await readBasketCount(page.api)} />
      <h1 className="text-heading font-semibold">Settings</h1>
      <a href={inFleet(BRIDGE_ROUTING_PATH, page.fleetId)} data-testid="bridge-settings-routing" className="flex flex-col rounded-md border border-border bg-card p-3 hover:bg-accent">
        <span>Where things show</span>
        <span className="text-caption text-muted-foreground">Per job, Slack, a chat, web push and email besides Bridge.</span>
      </a>
      {said === undefined ? null : <Notice message={said} isFailure={false} />}
      <Suspense fallback={<BridgeSkeleton />}>
        <SettingsParts api={page.api} fleetId={page.fleetId} />
      </Suspense>
    </div>
  );
}
