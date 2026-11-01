import { Suspense } from 'react';

import type { GatewayApi } from '../../../lib/gateway-api/gateway-api';
import { signedInPage, type SearchParams } from '../../../lib/gateway-api/page-api';
import { readBridgeRouting } from '../hooks/read-bridge';
import { BRIDGE_ROUTING_PATH } from '../paths';
import { slackLinkOutcomeOf } from '../services/slack-link-outcomes';
import { BridgeNoSignIn, BridgeShell } from './bridge-shell';
import { BridgeSkeleton } from '../ui/bridge-skeleton';
import { Notice } from '../ui/notice';
import { RoutingPanel } from './routing-panel';
import { SlackLinkPanel } from './slack-link-panel';
import { WebPushPanel } from './web-push-panel';

/** A place on top of the page: its name and what it does. */
function PlaceCard({ name, state }: { name: string; state: string }) {
  return (
    <div className="flex flex-col rounded-md border border-border bg-card p-3">
      <span>{name}</span>
      <span className="text-caption text-muted-foreground">{state}</span>
    </div>
  );
}

async function RoutingParts({ api, fleetId }: { api: GatewayApi; fleetId: string }) {
  const { routing, wakeChannels, slackLink } = await readBridgeRouting(api);
  if (routing === undefined) {
    return <p className="text-muted-foreground">Only a person routes what reaches them: this account has no person ship in this fleet.</p>;
  }
  return (
    <>
      <section className="grid gap-2" aria-labelledby="bridge-places-heading">
        <h2 id="bridge-places-heading" className="text-section font-semibold">
          The places
        </h2>
        {slackLink === undefined || slackLink === null ? <PlaceCard name="Slack" state="Not connected: this fleet has no Slack workspace." /> : <SlackLinkPanel fleetId={fleetId} slackLink={slackLink} />}
        <PlaceCard name="A chat" state="claude.ai or another MCP client, through the gateway: it lists what waits when you ask it." />
        {wakeChannels === undefined || wakeChannels.webPush.publicKey === null ? (
          <PlaceCard name="Web push" state="Not offered: this gateway sends no web push." />
        ) : (
          <WebPushPanel fleetId={fleetId} webPushKey={wakeChannels.webPush.publicKey} browsers={wakeChannels.webPush.browsers} />
        )}
        <PlaceCard name="Email" state={wakeChannels?.email.isOffered === true ? 'Says only that something waits, with a link here. Nothing is on until you turn it on.' : 'Not offered: this gateway sends no email.'} />
      </section>
      <RoutingPanel fleetId={fleetId} routing={routing} isSlackLinked={slackLink?.link !== null && slackLink !== undefined} />
    </>
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
      <div className="grid gap-6">
        <h1 className="text-heading font-semibold">Where things show</h1>
        <p className="text-muted-foreground">Per job, the places that show it besides Bridge. Bridge always keeps every item; a change applies at once and loses nothing.</p>
        {linked === undefined ? null : <Notice message={linked.message} isFailure={linked.isFailure} />}
        <Suspense fallback={<BridgeSkeleton />}>
          <RoutingParts api={page.api} fleetId={page.fleetId} />
        </Suspense>
      </div>
    </BridgeShell>
  );
}
