import { AddServer } from '../../../../features/add-server/ui/add-server';
import { ADD_SERVER_PATH, OUTSIDE_PARTIES_PATH } from '../../../../features/outside-parties/paths';
import { APPROVING_SCOPE } from '../../../../features/outside-party/ui/outside-party';
import { BridgeNoSignIn, BridgeShell } from '../../../../features/bridge/state/bridge-shell';
import { inFleet } from '../../../../lib/gateway-api/page-account';
import { signedInPage, type SearchParams } from '../../../../lib/gateway-api/page-api';

export default async function AddServerPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await signedInPage({ path: ADD_SERVER_PATH, searchParams: await searchParams });
  if (page.kind === 'noSignIn') {
    return <BridgeNoSignIn />;
  }
  return (
    <BridgeShell api={page.api} fleetId={page.fleetId} screen="outside-parties" below={{ name: 'Add MCP server', parentHref: inFleet(OUTSIDE_PARTIES_PATH, page.fleetId) }}>
      <AddServer fleetId={page.fleetId} canSwitchTools={page.scopes.includes(APPROVING_SCOPE)} />
    </BridgeShell>
  );
}
