import { Suspense } from 'react';

import type { GatewayApi } from '../../../lib/gateway-api/gateway-api';
import { signedInPage, type SearchParams } from '../../../lib/gateway-api/page-api';
import { readBasket } from '../hooks/read-bridge';
import { BRIDGE_BASKET_PATH } from '../paths';
import { BridgeNoSignIn, BridgeShell } from './bridge-shell';
import { BridgeSkeleton } from '../ui/bridge-skeleton';
import { PageAsLastRead } from './page-as-last-read';
import { BasketPanel } from './basket-panel';

async function BasketParts({ api, fleetId }: { api: GatewayApi; fleetId: string }) {
  const read = await readBasket(api);
  return (
    <PageAsLastRead read={read}>
      {read.kind === 'unreadable' ? null : <BasketPanel fleetId={fleetId} basket={read.kind === 'read' ? read.value : { count: 0, toSend: 0, entries: [] }} />}
    </PageAsLastRead>
  );
}

/**
 * The basket (docs/design/bridge, section 9; CC21): the answers the person
 * picked in Bridge and has not sent, kept by the gateway, so another device
 * shows the same basket. It reads itself again whenever the person ship's
 * items change, as while its answers are being sent.
 */
export async function BridgeBasketPage({ searchParams }: { searchParams: SearchParams }) {
  const page = await signedInPage({ path: BRIDGE_BASKET_PATH, searchParams });
  if (page.kind === 'noSignIn') {
    return <BridgeNoSignIn />;
  }
  return (
    <BridgeShell api={page.api} fleetId={page.fleetId} screen="basket">
      <div className="grid gap-6">
        <Suspense fallback={<BridgeSkeleton />}>
          <BasketParts api={page.api} fleetId={page.fleetId} />
        </Suspense>
      </div>
    </BridgeShell>
  );
}
