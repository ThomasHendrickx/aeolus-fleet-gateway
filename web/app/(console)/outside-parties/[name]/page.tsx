import type { Metadata } from 'next';

import { OutsideParty } from '../../../../features/outside-party/ui/outside-party';
import { partyPath } from '../../../../features/outside-parties/paths';
import { NoSignIn } from '../../../../features/sign-in/ui/no-sign-in';
import { signedInPage, type SearchParams } from '../../../../lib/gateway-api/page-api';

export const metadata: Metadata = { title: 'Outside parties' };

export default async function OutsidePartyPage({ params, searchParams }: { params: Promise<{ name: string }>; searchParams: Promise<SearchParams> }) {
  const { name } = await params;
  const page = await signedInPage({ path: partyPath(name), searchParams: await searchParams });
  if (page.kind === 'noSignIn') {
    return <NoSignIn />;
  }
  return <OutsideParty page={page} name={name} />;
}
