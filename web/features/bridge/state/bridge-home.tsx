import { Suspense } from 'react';

import type { GatewayApi } from '../../../lib/gateway-api/gateway-api';
import { signedInPage, type SearchParams } from '../../../lib/gateway-api/page-api';
import { NoSignIn } from '../../sign-in/ui/no-sign-in';
import { readBridgeHome } from '../hooks/read-bridge';
import { BRIDGE_PATH } from '../paths';
import { BridgeNav } from '../ui/bridge-nav';
import { BridgeSkeleton } from '../ui/bridge-skeleton';
import { HomePanel } from './home-panel';
import { LiveRefresh } from './live-refresh';
import { RecordUnreadable } from './record-unreadable';

/** For an account with no person ship nothing waits, and nothing reaches it unasked. */
const NOTHING = { waiting: { count: 0, items: [] }, stayAware: [] };

async function HomeParts({ api, fleetId }: { api: GatewayApi; fleetId: string }) {
  const read = await readBridgeHome(api);
  switch (read.kind) {
    case 'read':
      return <HomePanel fleetId={fleetId} home={read.value} />;
    case 'none':
      return <HomePanel fleetId={fleetId} home={NOTHING} />;
    case 'unreadable':
      return <RecordUnreadable message={read.message} />;
  }
}

/**
 * Bridge home (docs/design/bridge, CC18), where signing in lands: what waits
 * on the person with one count, and the stay-aware feed. Signed out, the
 * browser goes to sign in before anything shows; signed in, the shape shows
 * while it loads. It reads itself again whenever the person ship's items
 * change, and tells the gateway while it is in focus (wake a person, W6).
 */
export async function BridgeHomePage({ searchParams }: { searchParams: SearchParams }) {
  const page = await signedInPage({ path: BRIDGE_PATH, searchParams });
  if (page.kind === 'noSignIn') {
    return <NoSignIn />;
  }
  return (
    <div className="grid gap-6">
      <LiveRefresh fleetId={page.fleetId} />
      <BridgeNav fleetId={page.fleetId} current="home" />
      <Suspense fallback={<BridgeSkeleton />}>
        <HomeParts api={page.api} fleetId={page.fleetId} />
      </Suspense>
    </div>
  );
}
