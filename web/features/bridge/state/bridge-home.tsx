import { Suspense } from 'react';

import type { GatewayApi } from '../../../lib/gateway-api/gateway-api';
import { signedInPage, type SearchParams } from '../../../lib/gateway-api/page-api';
import { readYourFleet, type FleetRead } from '../fleet/hooks/read-your-fleet';
import { YourFleetPanel } from '../fleet/state/your-fleet-panel';
import { readArgoInboxNotice, readArgoSection, readBridgeHome, readDecidePlaces, readSlackDroppedOut, readTimeOf } from '../hooks/read-bridge';
import { readConsoleUrl } from '../hooks/read-console-url';
import { argoInboxNoticeOf } from '../services/argo-inbox-notice';
import { BRIDGE_PATH } from '../paths';
import { ArgoInboxNotice } from '../ui/argo-inbox-notice';
import { ArgoSectionPanel } from './argo-section-panel';
import { BridgeNoSignIn, BridgeShell } from './bridge-shell';
import { BridgeSkeleton } from '../ui/bridge-skeleton';
import { HomeColumns } from '../ui/home-columns';
import { SlackDroppedOut } from '../ui/slack-dropped-out';
import { HomePanel } from './home-panel';
import { KeptRead } from './kept-read';
import { HomeHeading } from './home-heading';
import { RecordUnreadable } from './record-unreadable';

/** For an account with no person ship nothing waits, and nothing reaches it unasked. */
const NOTHING = { waiting: { count: 0, items: [] }, stayAware: [] };

/**
 * Your fleet beside home once both are read; the fleet was asked for at the
 * same time as home, so neither waits on the other. While either cannot be
 * read, the browser shows it as last read (states.html).
 */
async function HomeParts({ api, fleetId, fleet }: { api: GatewayApi; fleetId: string; fleet: Promise<FleetRead> }) {
  const [read, decidePlaces, fleetRead, slackDroppedOut, argoNotice, argoSection, consoleUrl] = await Promise.all([readBridgeHome(api), readDecidePlaces(api), fleet, readSlackDroppedOut(api), readArgoInboxNotice(api), readArgoSection(api), readConsoleUrl(fleetId)]);
  const isNothingWaiting = read.kind !== 'unreadable' && (read.kind === 'none' || read.value.waiting.items.length === 0);
  const readAt = readTimeOf(read);
  const home = read.kind === 'read' ? read.value : NOTHING;
  const now = new Date().toISOString();
  const argo = argoSection === null ? undefined : <ArgoSectionPanel section={argoSection} now={now} />;
  const argoInboxNotice = argoInboxNoticeOf(argoNotice);
  return (
    <HomeColumns
      heading={<KeptRead readAt={readAt}>{read.kind === 'unreadable' ? null : <HomeHeading waiting={home.waiting} />}</KeptRead>}
      banner={
        <>
          {read.kind === 'unreadable' ? <RecordUnreadable whoDidNotAnswer={read.whoDidNotAnswer} /> : null}
          {argoInboxNotice === null ? null : <ArgoInboxNotice notice={argoInboxNotice} />}
          <KeptRead readAt={slackDroppedOut === undefined ? undefined : new Date().toISOString()}>{slackDroppedOut === undefined || slackDroppedOut === null ? null : <SlackDroppedOut fleetId={fleetId} botName={slackDroppedOut.botName} />}</KeptRead>
        </>
      }
      main={
        <>
          <KeptRead readAt={readAt}>{read.kind === 'unreadable' ? null : <HomePanel fleetId={fleetId} home={home} now={now} decidePlaces={read.kind === 'read' ? decidePlaces : undefined} argo={argo} />}</KeptRead>
          {read.kind === 'unreadable' ? (argo ?? null) : null}
        </>
      }
      aside={
        <KeptRead readAt={fleetRead.kind === 'unreadable' ? undefined : new Date().toISOString()}>
          <YourFleetPanel fleetId={fleetId} consoleUrl={consoleUrl} read={fleetRead} phone={isNothingWaiting ? 'numbers' : 'hidden'} isRecordUnreadable={read.kind === 'unreadable'} />
        </KeptRead>
      }
    />
  );
}

/**
 * Bridge home (docs/design/bridge, CC18), where signing in lands: what waits
 * on the person with one count, and the stay-aware feed, with Your fleet
 * beside them, and why Slack shows nothing when it dropped out. Signed out, the browser goes to sign in before anything
 * shows; signed in, the shape shows
 * while it loads. It reads itself again whenever the person ship's items
 * change, and tells the gateway while it is in focus (wake a person, W6).
 * An account allowed as argo sees what waits at argo below what waits on
 * them, with its own count, and is told while argo has not let the gateway
 * read argo's inbox (argo's inbox, AI4 and section 4).
 */
export async function BridgeHomePage({ searchParams }: { searchParams: SearchParams }) {
  const page = await signedInPage({ path: BRIDGE_PATH, searchParams });
  if (page.kind === 'noSignIn') {
    return <BridgeNoSignIn />;
  }
  return (
    <BridgeShell api={page.api} fleetId={page.fleetId} screen="home">
      <div className="grid gap-6">
        <Suspense fallback={<BridgeSkeleton />}>
          <HomeParts api={page.api} fleetId={page.fleetId} fleet={readYourFleet(page.api)} />
        </Suspense>
      </div>
    </BridgeShell>
  );
}
