import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { readWaiting } from '../../../../features/authorize/hooks/read-authorize';
import { WAITING_DOOR } from '../../../../features/authorize/hooks/use-follow-waiting';
import { WaitingForApproval } from '../../../../features/authorize/ui/waiting-for-approval';
import type { SearchParams } from '../../../../lib/gateway-api/page-api';

export const metadata: Metadata = { title: 'Waiting for approval' };

export default async function WaitingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { waiting } = await searchParams;
  const asked = typeof waiting === 'string' ? waiting : '';
  const read = await readWaiting(asked);
  if (read.kind === 'goOn') {
    // Whatever no longer waits, refused or decided, the gateway's waiting address says.
    redirect(`${WAITING_DOOR}?${new URLSearchParams({ waiting: asked }).toString()}`);
  }
  return <WaitingForApproval waiting={asked} clientName={read.clientName} expiresAt={read.expiresAt} shownAt={new Date().toISOString()} />;
}
