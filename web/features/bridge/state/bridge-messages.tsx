import { Suspense } from 'react';

import type { GatewayApi } from '../../../lib/gateway-api/gateway-api';
import { signedInPage, type SearchParams } from '../../../lib/gateway-api/page-api';
import { readBridgeHome } from '../hooks/read-bridge';
import { BRIDGE_MESSAGES_PATH } from '../paths';
import { BridgeSkeleton } from '../ui/bridge-skeleton';
import { BridgeNoSignIn, BridgeShell } from './bridge-shell';
import { MessagesPanel } from './messages-panel';
import { PageAsLastRead } from './page-as-last-read';

async function MessagesParts({ api, fleetId }: { api: GatewayApi; fleetId: string }) {
  const read = await readBridgeHome(api);
  return (
    <PageAsLastRead read={read}>
      {read.kind === 'unreadable' ? null : <MessagesPanel fleetId={fleetId} messages={read.kind === 'read' ? read.value.messages : []} now={new Date().toISOString()} />}
    </PageAsLastRead>
  );
}

/**
 * Messages (#242), a page of the shell under the Waiting tab: every plain
 * message to the person as Bridge home reads them. Signed out, the browser
 * goes to sign in before anything shows.
 */
export async function BridgeMessagesPage({ searchParams }: { searchParams: SearchParams }) {
  const page = await signedInPage({ path: BRIDGE_MESSAGES_PATH, searchParams });
  if (page.kind === 'noSignIn') {
    return <BridgeNoSignIn />;
  }
  return (
    <BridgeShell api={page.api} fleetId={page.fleetId} screen="messages">
      <Suspense fallback={<BridgeSkeleton />}>
        <MessagesParts api={page.api} fleetId={page.fleetId} />
      </Suspense>
    </BridgeShell>
  );
}
