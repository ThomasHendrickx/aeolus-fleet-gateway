import type { Metadata } from 'next';

import { NoSignIn } from '../../../../features/sign-in/ui/no-sign-in';
import { EXPOSE_SHIP_PATH } from '../../../../features/slack/paths';
import { ExposeShip } from '../../../../features/slack/ui/expose-ship';
import { signedInPage, type SearchParams } from '../../../../lib/gateway-api/page-api';

export const metadata: Metadata = { title: 'Slack' };

export default async function ExposeShipPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await signedInPage({ path: EXPOSE_SHIP_PATH, searchParams: await searchParams });
  if (page.kind === 'noSignIn') {
    return <NoSignIn />;
  }
  return <ExposeShip page={page} />;
}
