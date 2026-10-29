import type { Metadata } from 'next';

import { NoSignIn } from '../../../features/sign-in/ui/no-sign-in';
import { SLACK_PATH } from '../../../features/slack/paths';
import { Slack } from '../../../features/slack/ui/slack';
import { signedInPage, type SearchParams } from '../../../lib/gateway-api/page-api';

export const metadata: Metadata = { title: 'Slack' };

export default async function SlackPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const parameters = await searchParams;
  const page = await signedInPage({ path: SLACK_PATH, searchParams: parameters });
  if (page.kind === 'noSignIn') {
    return <NoSignIn />;
  }
  return <Slack page={page} install={typeof parameters.install === 'string' ? parameters.install : undefined} />;
}
