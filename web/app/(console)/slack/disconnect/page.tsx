import type { Metadata } from 'next';

import { NoSignIn } from '../../../../features/sign-in/ui/no-sign-in';
import { DISCONNECT_SLACK_PATH } from '../../../../features/slack/paths';
import { DisconnectSlack } from '../../../../features/slack/ui/disconnect-slack';
import { signedInPage, type SearchParams } from '../../../../lib/gateway-api/page-api';

export const metadata: Metadata = { title: 'Slack' };

export default async function DisconnectSlackPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await signedInPage({ path: DISCONNECT_SLACK_PATH, searchParams: await searchParams });
  if (page.kind === 'noSignIn') {
    return <NoSignIn />;
  }
  return <DisconnectSlack page={page} />;
}
