import { Suspense } from 'react';

import type { GatewayApi } from '../../../lib/gateway-api/gateway-api';
import { signedInPage, type SearchParams } from '../../../lib/gateway-api/page-api';
import { NoSignIn } from '../../sign-in/ui/no-sign-in';
import { readBasket, readBasketCount } from '../hooks/read-bridge';
import { BRIDGE_BASKET_PATH } from '../paths';
import { BridgeNav } from '../ui/bridge-nav';
import { BridgeSkeleton } from '../ui/bridge-skeleton';
import { BasketPanel } from './basket-panel';
import { LiveRefresh } from './live-refresh';
import { RecordUnreadable } from './record-unreadable';

async function BasketParts({ api, fleetId }: { api: GatewayApi; fleetId: string }) {
  const read = await readBasket(api);
  switch (read.kind) {
    case 'read':
      return <BasketPanel fleetId={fleetId} basket={read.value} />;
    case 'none':
      return <BasketPanel fleetId={fleetId} basket={{ count: 0, toSend: 0, entries: [] }} />;
    case 'unreadable':
      return <RecordUnreadable message={read.message} />;
  }
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
    return <NoSignIn />;
  }
  return (
    <div className="grid gap-6">
      <LiveRefresh fleetId={page.fleetId} />
      <BridgeNav fleetId={page.fleetId} current="basket" basketCount={await readBasketCount(page.api)} />
      <Suspense fallback={<BridgeSkeleton />}>
        <BasketParts api={page.api} fleetId={page.fleetId} />
      </Suspense>
    </div>
  );
}
