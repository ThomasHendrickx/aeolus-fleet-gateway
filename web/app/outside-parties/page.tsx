import type { Metadata } from 'next';

import { OUTSIDE_PARTIES_PATH } from '../../features/outside-parties/paths';
import { NoSignIn } from '../../features/sign-in/ui/no-sign-in';
import { signedInPage, type SearchParams } from '../../lib/gateway-api/page-api';

export const metadata: Metadata = { title: 'Outside parties' };

export default async function OutsidePartiesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await signedInPage({ path: OUTSIDE_PARTIES_PATH, searchParams: await searchParams });
  if (page.kind === 'noSignIn') {
    return <NoSignIn />;
  }
  return <h1 className="text-title font-semibold">Outside parties</h1>;
}
