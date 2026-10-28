import type { Metadata } from 'next';

import { NoSignIn } from '../../../../features/sign-in/ui/no-sign-in';
import { removeBotPath } from '../../../../features/slack/paths';
import { RemoveBot } from '../../../../features/slack/ui/remove-bot';
import { signedInPage, type SearchParams } from '../../../../lib/gateway-api/page-api';

export const metadata: Metadata = { title: 'Slack' };

export default async function RemoveBotPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const parameters = await searchParams;
  const appId = typeof parameters.app === 'string' ? parameters.app : '';
  const page = await signedInPage({ path: removeBotPath(appId), searchParams: parameters });
  if (page.kind === 'noSignIn') {
    return <NoSignIn />;
  }
  return <RemoveBot page={page} appId={appId} />;
}
