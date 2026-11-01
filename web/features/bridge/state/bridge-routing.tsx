import { Suspense } from 'react';

import type { GatewayApi } from '../../../lib/gateway-api/gateway-api';
import { signedInPage, type SearchParams } from '../../../lib/gateway-api/page-api';
import { readBridgeRouting } from '../hooks/read-bridge';
import { BRIDGE_ROUTING_PATH } from '../paths';
import { slackLinkOutcomeOf } from '../services/slack-link-outcomes';
import { BridgeNoSignIn, BridgeShell } from './bridge-shell';
import { BridgeSkeleton } from '../ui/bridge-skeleton';
import { Notice } from '../ui/notice';
import { PlacesPanel } from './places-panel';
import { RoutingPanel } from './routing-panel';

async function RoutingParts({ api, fleetId }: { api: GatewayApi; fleetId: string }) {
  const { routing, wakeChannels, slackLink, chats, waitingByJob } = await readBridgeRouting(api);
  if (routing === undefined) {
    return <p className="text-muted-foreground">Only a person routes what reaches them: this account has no person ship in this fleet.</p>;
  }
  return (
    <div className="flex flex-col gap-3 max-sm:flex-col-reverse">
      <PlacesPanel fleetId={fleetId} routing={routing} slackLink={slackLink ?? null} chats={chats} webPush={wakeChannels?.webPush} />
      <RoutingPanel fleetId={fleetId} routing={routing} isSlackLinked={slackLink !== undefined && slackLink !== null && slackLink.link !== null} waitingByJob={waitingByJob} />
    </div>
  );
}

/**
 * Where things show (Bridge, section 8; the routing mockup): the places on
 * top, each with its state and its one action, then per job the places that
 * show it besides Bridge, which always keeps every item. It replaces the
 * Overview's Slack switch, its wake section and P-B5 (CC17). Signed out, the
 * browser goes to sign in before anything shows.
 */
export async function BridgeRoutingPage({ searchParams }: { searchParams: SearchParams }) {
  const page = await signedInPage({ path: BRIDGE_ROUTING_PATH, searchParams });
  if (page.kind === 'noSignIn') {
    return <BridgeNoSignIn />;
  }
  const linked = slackLinkOutcomeOf(searchParams);
  return (
    <BridgeShell api={page.api} fleetId={page.fleetId} screen="routing">
      <div className="flex flex-col gap-3">
        <div>
          <h1 className="text-heading font-semibold max-sm:hidden">Where things show</h1>
          <p className="text-muted-foreground max-sm:hidden">Per job, the places that show it besides Bridge. Bridge always keeps every item; a change applies at once and loses nothing.</p>
          <p className="text-caption text-muted-foreground sm:hidden">Bridge always keeps every item.</p>
        </div>
        {linked === undefined ? null : <Notice message={linked.message} isFailure={linked.isFailure} />}
        <Suspense fallback={<BridgeSkeleton />}>
          <RoutingParts api={page.api} fleetId={page.fleetId} />
        </Suspense>
      </div>
    </BridgeShell>
  );
}
