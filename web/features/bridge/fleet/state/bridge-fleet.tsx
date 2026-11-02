import { Suspense } from 'react';

import type { GatewayApi } from '../../../../lib/gateway-api/gateway-api';
import { signedInPage, type SearchParams } from '../../../../lib/gateway-api/page-api';
import { BridgeNoSignIn, BridgeShell } from '../../state/bridge-shell';
import { BridgeSkeleton } from '../../ui/bridge-skeleton';
import { readConsoleUrl } from '../../hooks/read-console-url';
import { readYourFleet } from '../hooks/read-your-fleet';
import { BRIDGE_FLEET_PATH } from '../paths';
import { FleetPage } from './fleet-page';

async function FleetParts({ api, fleetId }: { api: GatewayApi; fleetId: string }) {
  const [read, consoleUrl] = await Promise.all([readYourFleet(api), readConsoleUrl(fleetId)]);
  return <FleetPage read={read} consoleUrl={consoleUrl} />;
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
        <FleetParts api={page.api} fleetId={page.fleetId} />
      </Suspense>
    </BridgeShell>
  );
}
