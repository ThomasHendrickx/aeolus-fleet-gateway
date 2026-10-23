import type { Metadata } from 'next';

import { AddA2aAgent } from '../../../../features/add-a2a-agent/ui/add-a2a-agent';
import { ADD_A2A_AGENT_PATH, OUTSIDE_PARTIES_PATH } from '../../../../features/outside-parties/paths';
import { NoSignIn } from '../../../../features/sign-in/ui/no-sign-in';
import { inFleet } from '../../../../lib/gateway-api/page-account';
import { signedInPage, type SearchParams } from '../../../../lib/gateway-api/page-api';

export const metadata: Metadata = { title: 'Add A2A agent' };

export default async function AddA2aAgentPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await signedInPage({ path: ADD_A2A_AGENT_PATH, searchParams: await searchParams });
  if (page.kind === 'noSignIn') {
    return <NoSignIn />;
  }
  return (
    <div className="grid gap-4">
      <a href={inFleet(OUTSIDE_PARTIES_PATH, page.fleetId)} className="text-muted-foreground hover:text-foreground">
        ← Outside parties
      </a>
      <AddA2aAgent page={page} />
    </div>
  );
}
