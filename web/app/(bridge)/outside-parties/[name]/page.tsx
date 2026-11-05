import { signInOutcomeOf } from '../../../../features/outside-party/own-sign-in';
import { OutsideParty } from '../../../../features/outside-party/ui/outside-party';
import { OUTSIDE_PARTIES_PATH, partyPath } from '../../../../features/outside-parties/paths';
import { BridgeNoSignIn, BridgeShell } from '../../../../features/bridge/state/bridge-shell';
import { inFleet } from '../../../../lib/gateway-api/page-account';
import { signedInPage, type SearchParams } from '../../../../lib/gateway-api/page-api';

export default async function OutsidePartyPage({ params, searchParams }: { params: Promise<{ name: string }>; searchParams: Promise<SearchParams> }) {
  const { name } = await params;
  const asked = await searchParams;
  const page = await signedInPage({ path: partyPath(name), searchParams: asked });
  if (page.kind === 'noSignIn') {
    return <BridgeNoSignIn />;
  }
  return (
    <BridgeShell api={page.api} fleetId={page.fleetId} screen="outside-parties" below={{ name, parentHref: inFleet(OUTSIDE_PARTIES_PATH, page.fleetId) }}>
      <OutsideParty page={page} name={name} outcome={signInOutcomeOf(asked)} />
    </BridgeShell>
  );
}
