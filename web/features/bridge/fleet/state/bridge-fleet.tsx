import { Suspense } from 'react';

import type { GatewayApi } from '../../../../lib/gateway-api/gateway-api';
import { signedInPage, type SearchParams } from '../../../../lib/gateway-api/page-api';
import { BridgeNoSignIn, BridgeShell } from '../../state/bridge-shell';
import { BridgeSkeleton } from '../../ui/bridge-skeleton';
import { readYourFleet } from '../hooks/read-your-fleet';
import { BRIDGE_FLEET_PATH } from '../paths';
import { FleetPage } from './fleet-page';

async function FleetParts({ api }: { api: GatewayApi }) {
  return <FleetPage read={await readYourFleet(api)} />;
}

/** Your fleet, whole (the phone's Fleet tab): read as the signed-in account each time the page is read. */
export async function BridgeFleetPage({ searchParams }: { searchParams: SearchParams }) {
  const page = await signedInPage({ path: BRIDGE_FLEET_PATH, searchParams });
  if (page.kind === 'noSignIn') {
    return <BridgeNoSignIn />;
  }
  return (
    <BridgeShell api={page.api} fleetId={page.fleetId} screen="fleet">
      <Suspense fallback={<BridgeSkeleton />}>
        <FleetParts api={page.api} />
      </Suspense>
    </BridgeShell>
  );
}
