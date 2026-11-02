import type { Metadata } from 'next';

import { RetireParty } from '../../../../../features/outside-party/ui/retire-party';
import { OUTSIDE_PARTIES_PATH, partyPath } from '../../../../../features/outside-parties/paths';
import { BridgeNoSignIn, BridgeShell } from '../../../../../features/bridge/state/bridge-shell';
import { inFleet } from '../../../../../lib/gateway-api/page-account';
import { signedInPage, type SearchParams } from '../../../../../lib/gateway-api/page-api';

export const metadata: Metadata = { title: 'Outside parties' };

export default async function RetirePartyPage({ params, searchParams }: { params: Promise<{ name: string }>; searchParams: Promise<SearchParams> }) {
  const { name } = await params;
  const page = await signedInPage({ path: partyPath(name, 'retire'), searchParams: await searchParams });
  if (page.kind === 'noSignIn') {
    return <BridgeNoSignIn />;
  }
  return (
    <BridgeShell api={page.api} fleetId={page.fleetId} screen="outside-parties" below={{ name: 'Retire', parentHref: inFleet(OUTSIDE_PARTIES_PATH, page.fleetId), via: { name, href: inFleet(partyPath(name), page.fleetId) } }}>
      <RetireParty page={page} name={name} />
    </BridgeShell>
  );
}
