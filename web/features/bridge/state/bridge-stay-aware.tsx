import { Suspense } from 'react';

import type { GatewayApi } from '../../../lib/gateway-api/gateway-api';
import { signedInPage, type SearchParams } from '../../../lib/gateway-api/page-api';
import { readBridgeHome } from '../hooks/read-bridge';
import { BRIDGE_STAY_AWARE_PATH } from '../paths';
import { BridgeSkeleton } from '../ui/bridge-skeleton';
import { PageAsLastRead } from './page-as-last-read';
import { BridgeNoSignIn, BridgeShell } from './bridge-shell';
import { StayAwarePanel } from './stay-aware-panel';

async function StayAwareParts({ api, fleetId }: { api: GatewayApi; fleetId: string }) {
  const read = await readBridgeHome(api);
  return (
    <PageAsLastRead read={read}>
      {read.kind === 'unreadable' ? null : <StayAwarePanel fleetId={fleetId} stayAware={read.kind === 'read' ? read.value.stayAware : []} now={new Date().toISOString()} />}
    </PageAsLastRead>
  );
}

/**
 * Stay aware (docs/design/bridge, CC16), a page of the shell: the feed of
 * alerts and notices not seen yet, as Bridge home lists it. Signed out,
 * the browser goes to sign in before anything shows.
 */
export async function BridgeStayAwarePage({ searchParams }: { searchParams: SearchParams }) {
  const page = await signedInPage({ path: BRIDGE_STAY_AWARE_PATH, searchParams });
  if (page.kind === 'noSignIn') {
    return <BridgeNoSignIn />;
  }
  return (
    <BridgeShell api={page.api} fleetId={page.fleetId} screen="stay-aware">
      <Suspense fallback={<BridgeSkeleton />}>
        <StayAwareParts api={page.api} fleetId={page.fleetId} />
      </Suspense>
    </BridgeShell>
  );
}
