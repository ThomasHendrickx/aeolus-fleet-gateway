import { Suspense, type ReactNode } from 'react';

import type { GatewayApi } from '../../../lib/gateway-api/gateway-api';
import { signedInPage, type SearchParams } from '../../../lib/gateway-api/page-api';
import { readRecordPage, type BridgeRead } from '../hooks/read-bridge';
import type { RecordPage } from '../services/items';
import { BRIDGE_DONE_PATH } from '../paths';
import { BridgeNoSignIn, BridgeShell } from './bridge-shell';
import { BridgeSkeleton } from '../ui/bridge-skeleton';
import { PageAsLastRead } from './page-as-last-read';
import { DonePanel } from './done-panel';

function doneListOf(fleetId: string, read: BridgeRead<RecordPage>): ReactNode {
  switch (read.kind) {
    case 'read':
      // A change to the record reads the first page again, in place of what was shown.
      return <DonePanel key={read.value.items.map(({ deliveryId, state }) => `${deliveryId}:${state}`).join(',')} fleetId={fleetId} first={read.value} />;
    case 'none':
      return <DonePanel fleetId={fleetId} first={{ items: [], nextCursor: null }} />;
    case 'unreadable':
      return null;
  }
}

async function DoneParts({ api, fleetId }: { api: GatewayApi; fleetId: string }) {
  const read = await readRecordPage(api, null);
  return <PageAsLastRead read={read}>{doneListOf(fleetId, read)}</PageAsLastRead>;
}

/** Done (docs/design/bridge, CC4, CC12): the person ship's record, read from core a page at a time, each item with what came of it and where. */
export async function BridgeDonePage({ searchParams }: { searchParams: SearchParams }) {
  const page = await signedInPage({ path: BRIDGE_DONE_PATH, searchParams });
  if (page.kind === 'noSignIn') {
    return <BridgeNoSignIn />;
  }
  return (
    <BridgeShell api={page.api} fleetId={page.fleetId} screen="done">
      <div className="grid gap-6">
        <Suspense fallback={<BridgeSkeleton />}>
          <DoneParts api={page.api} fleetId={page.fleetId} />
        </Suspense>
      </div>
    </BridgeShell>
  );
}
