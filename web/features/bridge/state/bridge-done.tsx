import { Suspense } from 'react';

import type { GatewayApi } from '../../../lib/gateway-api/gateway-api';
import { signedInPage, type SearchParams } from '../../../lib/gateway-api/page-api';
import { NoSignIn } from '../../sign-in/ui/no-sign-in';
import { readRecordPage } from '../hooks/read-bridge';
import { BRIDGE_DONE_PATH } from '../paths';
import { BridgeNav } from '../ui/bridge-nav';
import { BridgeSkeleton } from '../ui/bridge-skeleton';
import { DonePanel } from './done-panel';
import { LiveRefresh } from './live-refresh';
import { RecordUnreadable } from './record-unreadable';

async function DoneParts({ api, fleetId }: { api: GatewayApi; fleetId: string }) {
  const read = await readRecordPage(api, null);
  switch (read.kind) {
    case 'read':
      // A change to the record reads the first page again, in place of what was shown.
      return <DonePanel key={read.value.items.map(({ deliveryId, state }) => `${deliveryId}:${state}`).join(',')} fleetId={fleetId} first={read.value} />;
    case 'none':
      return <DonePanel fleetId={fleetId} first={{ items: [], nextCursor: null }} />;
    case 'unreadable':
      return <RecordUnreadable message={read.message} />;
  }
}

/** Done (docs/design/bridge, CC4, CC12): the person ship's record, read from core a page at a time, each item with what came of it and where. */
export async function BridgeDonePage({ searchParams }: { searchParams: SearchParams }) {
  const page = await signedInPage({ path: BRIDGE_DONE_PATH, searchParams });
  if (page.kind === 'noSignIn') {
    return <NoSignIn />;
  }
  return (
    <div className="grid gap-6">
      <LiveRefresh fleetId={page.fleetId} />
      <BridgeNav fleetId={page.fleetId} current="done" />
      <Suspense fallback={<BridgeSkeleton />}>
        <DoneParts api={page.api} fleetId={page.fleetId} />
      </Suspense>
    </div>
  );
}
