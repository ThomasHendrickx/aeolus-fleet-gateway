import { ChangeParty } from '../../../../../features/outside-party/ui/change-party';
import { OUTSIDE_PARTIES_PATH, partyPath } from '../../../../../features/outside-parties/paths';
import { BridgeNoSignIn, BridgeShell } from '../../../../../features/bridge/state/bridge-shell';
import { inFleet } from '../../../../../lib/gateway-api/page-account';
import { signedInPage, type SearchParams } from '../../../../../lib/gateway-api/page-api';

export default async function ChangePartyPage({ params, searchParams }: { params: Promise<{ name: string }>; searchParams: Promise<SearchParams> }) {
  const { name } = await params;
  const page = await signedInPage({ path: partyPath(name, 'change'), searchParams: await searchParams });
  if (page.kind === 'noSignIn') {
    return <BridgeNoSignIn />;
  }
  return (
    <BridgeShell api={page.api} fleetId={page.fleetId} screen="outside-parties" below={{ name: 'Change', parentHref: inFleet(OUTSIDE_PARTIES_PATH, page.fleetId), via: { name, href: inFleet(partyPath(name), page.fleetId) } }}>
      <ChangeParty page={page} name={name} />
    </BridgeShell>
  );
}
