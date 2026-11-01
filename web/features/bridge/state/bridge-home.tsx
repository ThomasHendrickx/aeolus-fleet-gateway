import { Suspense } from 'react';

import type { GatewayApi } from '../../../lib/gateway-api/gateway-api';
import { signedInPage, type SearchParams } from '../../../lib/gateway-api/page-api';
import { readYourFleet, type FleetRead } from '../fleet/hooks/read-your-fleet';
import { YourFleetPanel } from '../fleet/state/your-fleet-panel';
import { readArgoInboxNotice, readArgoSection, readBridgeHome, readDecidePlaces } from '../hooks/read-bridge';
import { argoInboxNoticeOf } from '../services/argo-inbox-notice';
import { BRIDGE_PATH } from '../paths';
import { ArgoInboxNotice } from '../ui/argo-inbox-notice';
import { ArgoSectionList } from '../ui/argo-section';
import { BridgeNoSignIn, BridgeShell } from './bridge-shell';
import { BridgeSkeleton } from '../ui/bridge-skeleton';
import { HomeColumns } from '../ui/home-columns';
import { HomePanel } from './home-panel';
import { RecordUnreadable } from './record-unreadable';

/** For an account with no person ship nothing waits, and nothing reaches it unasked. */
const NOTHING = { waiting: { count: 0, items: [] }, stayAware: [] };

/** Your fleet beside home once both are read; the fleet was asked for at the same time as home, so neither waits on the other. */
async function HomeParts({ api, fleetId, fleet }: { api: GatewayApi; fleetId: string; fleet: Promise<FleetRead> }) {
  const [read, decidePlaces, fleetRead, argoNotice, argoSection] = await Promise.all([readBridgeHome(api), readDecidePlaces(api), fleet, readArgoInboxNotice(api), readArgoSection(api)]);
  const now = new Date().toISOString();
  const argo = argoSection === null ? undefined : <ArgoSectionList section={argoSection} now={now} />;
  const isNothingWaiting = read.kind !== 'unreadable' && (read.kind === 'none' || read.value.waiting.items.length === 0);
  const argoInboxNotice = argoInboxNoticeOf(argoNotice);
  return (
    <HomeColumns
      banner={
        read.kind === 'unreadable' || argoInboxNotice !== null ? (
          <>
            {read.kind === 'unreadable' ? <RecordUnreadable message={read.message} /> : null}
            {argoInboxNotice === null ? null : <ArgoInboxNotice notice={argoInboxNotice} />}
          </>
        ) : undefined
      }
      main={read.kind === 'unreadable' ? (argo ?? null) : read.kind === 'read' ? <HomePanel fleetId={fleetId} home={read.value} now={now} decidePlaces={decidePlaces} argo={argo} /> : <HomePanel fleetId={fleetId} home={NOTHING} now={now} argo={argo} />}
      aside={<YourFleetPanel fleetId={fleetId} read={fleetRead} phone={isNothingWaiting ? 'numbers' : 'hidden'} />}
    />
  );
}

/**
 * Bridge home (docs/design/bridge, CC18), where signing in lands: what waits
 * on the person with one count, and the stay-aware feed, with Your fleet
 * beside them. Signed out, the browser goes to sign in before anything
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
