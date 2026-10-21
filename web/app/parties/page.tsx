import type { Metadata } from 'next';

import { PARTIES_PATH } from '../../features/parties/paths';
import { Parties } from '../../features/parties/ui/parties';
import { NoSignIn } from '../../features/sign-in/ui/no-sign-in';
import { signedInPage, type SearchParams } from '../../lib/gateway-api/page-api';

export const metadata: Metadata = { title: 'Parties' };

export default async function PartiesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await signedInPage({ path: PARTIES_PATH, searchParams: await searchParams });
  if (page.kind === 'noSignIn') {
    return <NoSignIn />;
  }
  return <Parties page={page} />;
}
