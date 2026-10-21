import type { Metadata } from 'next';

import { ChangeParty } from '../../../../features/outside-party/ui/change-party';
import { partyPath } from '../../../../features/outside-parties/paths';
import { NoSignIn } from '../../../../features/sign-in/ui/no-sign-in';
import { signedInPage, type SearchParams } from '../../../../lib/gateway-api/page-api';

export const metadata: Metadata = { title: 'Outside parties' };

export default async function ChangePartyPage({ params, searchParams }: { params: Promise<{ name: string }>; searchParams: Promise<SearchParams> }) {
  const { name } = await params;
  const page = await signedInPage({ path: partyPath(name, 'change'), searchParams: await searchParams });
  if (page.kind === 'noSignIn') {
    return <NoSignIn />;
  }
  return <ChangeParty page={page} name={name} />;
}
