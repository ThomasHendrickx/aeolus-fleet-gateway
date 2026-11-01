import { Suspense } from 'react';

import type { GatewayApi } from '../../../lib/gateway-api/gateway-api';
import { signedInPage, type SearchParams } from '../../../lib/gateway-api/page-api';
import { readHeader } from '../../frame/hooks/read-header';
import { readBridgeHome, readRecordPage } from '../hooks/read-bridge';
import { BRIDGE_STAY_AWARE_PATH } from '../paths';
import { BridgeSkeleton } from '../ui/bridge-skeleton';
import { BridgeNoSignIn, BridgeShell } from './bridge-shell';
import { RecordUnreadable } from './record-unreadable';
import { StayAwarePanel } from './stay-aware-panel';

/** The fleet's console, where an alert's ship shows its Health; none while the account's apps cannot be read or name none. */
async function readConsoleUrl(fleetId: string): Promise<string | undefined> {
  return (await readHeader())?.fleets.find(({ id }) => id === fleetId)?.apps.find(({ app }) => app === 'console')?.url;
}

async function StayAwareParts({ api, fleetId }: { api: GatewayApi; fleetId: string }) {
  const [home, record, consoleUrl] = await Promise.all([readBridgeHome(api), readRecordPage(api, null), readConsoleUrl(fleetId)]);
  if (home.kind === 'unreadable') {
    return <RecordUnreadable message={home.message} />;
  }
  if (record.kind === 'unreadable') {
    return <RecordUnreadable message={record.message} />;
  }
  return <StayAwarePanel fleetId={fleetId} consoleUrl={consoleUrl} unseen={home.kind === 'read' ? home.value.stayAware : []} record={record.kind === 'read' ? record.value.items : []} />;
}

/**
 * Stay aware (docs/design/bridge, CC16), a page of the shell: the feed of
 * alerts and notices, the ones not seen yet as Bridge home reads them and
 * the seen ones from the record's newest page, read side by side. Signed out,
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
