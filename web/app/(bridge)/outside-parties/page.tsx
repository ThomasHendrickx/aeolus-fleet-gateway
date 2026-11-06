import { OutsideParties } from '../../../features/outside-parties/ui/outside-parties';
import { OUTSIDE_PARTIES_PATH } from '../../../features/outside-parties/paths';
import { BridgeNoSignIn, BridgeShell } from '../../../features/bridge/state/bridge-shell';
import { signedInPage, type SearchParams } from '../../../lib/gateway-api/page-api';

export default async function OutsidePartiesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const parameters = await searchParams;
  const page = await signedInPage({ path: OUTSIDE_PARTIES_PATH, searchParams: parameters });
  if (page.kind === 'noSignIn') {
    return <BridgeNoSignIn />;
  }
  const side = parameters.kind === 'server' || parameters.kind === 'client' ? parameters.kind : undefined;
  return (
    <BridgeShell api={page.api} fleetId={page.fleetId} screen="outside-parties">
      <OutsideParties page={page} side={side} />
    </BridgeShell>
  );
}
