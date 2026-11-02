import type { Metadata } from 'next';

import { AddA2aAgent } from '../../../../features/add-a2a-agent/ui/add-a2a-agent';
import { ADD_A2A_AGENT_PATH, OUTSIDE_PARTIES_PATH } from '../../../../features/outside-parties/paths';
import { BridgeNoSignIn, BridgeShell } from '../../../../features/bridge/state/bridge-shell';
import { inFleet } from '../../../../lib/gateway-api/page-account';
import { signedInPage, type SearchParams } from '../../../../lib/gateway-api/page-api';

export const metadata: Metadata = { title: 'Add A2A agent' };

export default async function AddA2aAgentPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await signedInPage({ path: ADD_A2A_AGENT_PATH, searchParams: await searchParams });
  if (page.kind === 'noSignIn') {
    return <BridgeNoSignIn />;
  }
  return (
    <BridgeShell api={page.api} fleetId={page.fleetId} screen="outside-parties" below={{ name: 'Add an A2A agent', parentHref: inFleet(OUTSIDE_PARTIES_PATH, page.fleetId) }}>
      <AddA2aAgent page={page} />
    </BridgeShell>
  );
}
