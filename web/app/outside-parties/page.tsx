import type { Metadata } from 'next';

import { OutsideParties } from '../../features/outside-parties/ui/outside-parties';
import { OUTSIDE_PARTIES_PATH } from '../../features/outside-parties/paths';
import { NoSignIn } from '../../features/sign-in/ui/no-sign-in';
import { signedInPage, type SearchParams } from '../../lib/gateway-api/page-api';

export const metadata: Metadata = { title: 'Outside parties' };

export default async function OutsidePartiesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const parameters = await searchParams;
  const page = await signedInPage({ path: OUTSIDE_PARTIES_PATH, searchParams: parameters });
  if (page.kind === 'noSignIn') {
    return <NoSignIn />;
  }
  const side = parameters.kind === 'server' || parameters.kind === 'client' ? parameters.kind : undefined;
  return <OutsideParties page={page} side={side} />;
}
