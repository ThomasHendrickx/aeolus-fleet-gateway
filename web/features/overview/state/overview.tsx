import { Suspense } from 'react';

import type { GatewayApi } from '../../../lib/gateway-api/gateway-api';
import { signedInPage, type SearchParams } from '../../../lib/gateway-api/page-api';
import { OVERVIEW_PATH, readOverview } from '../hooks/read-overview';
import { NoSignIn } from '../../sign-in/ui/no-sign-in';
import { Notice } from '../ui/notice';
import { OverviewLead } from '../ui/overview-lead';
import { OverviewSkeleton } from '../ui/overview-skeleton';
import { RequestsList } from '../ui/requests-list';
import { InboxPanel } from './inbox-panel';
import { LiveRefresh } from './live-refresh';
import { WakesPanel } from './wakes-panel';

/** What a decision the person just made came to, said once they are back. */
const DECIDED: Record<string, string> = {
  approve: 'You approved the request.',
  deny: 'You denied the request.',
};

async function OverviewParts({ api, fleetId }: { api: GatewayApi; fleetId: string }) {
  const { inbox, toDecide, mine, wakes } = await readOverview(api);
  const now = new Date();
  return (
    <>
      <OverviewLead waiting={inbox?.waiting} toDecide={toDecide?.length} />
      {inbox === undefined ? null : <InboxPanel fleetId={fleetId} inbox={inbox} />}
      {toDecide === undefined ? null : toDecide.length === 0 ? (
        <p className="text-muted-foreground">No request waits for a decision.</p>
      ) : (
        <RequestsList title="To decide" requests={toDecide} now={now} hrefOf={(request) => `/overview/requests/${encodeURIComponent(request.requestId)}?fleet=${encodeURIComponent(fleetId)}`} />
      )}
      {mine === undefined || mine.length === 0 ? null : <RequestsList title="Your requests" requests={mine} now={now} />}
      {wakes === undefined ? null : <WakesPanel fleetId={fleetId} wakes={wakes} />}
    </>
  );
}

/**
 * The Overview (design B, Signal): what waits on the person, their inbox,
 * the requests to decide for an approver, oldest first, the requests they
 * asked, and the channels that wake them. Signed out, the browser goes to
 * sign in before anything shows; signed in, the shape shows while the parts
 * load. It reads itself again whenever the fleet's requests change.
 */
export async function Overview({ searchParams }: { searchParams: SearchParams }) {
  const page = await signedInPage({ path: OVERVIEW_PATH, searchParams });
  if (page.kind === 'noSignIn') {
    return <NoSignIn />;
  }
  const { decided } = searchParams;
  const said = typeof decided === 'string' ? DECIDED[decided] : undefined;
  return (
    <div className="grid gap-6">
      <LiveRefresh fleetId={page.fleetId} />
      {said === undefined ? null : <Notice message={said} isFailure={false} />}
      <Suspense fallback={<OverviewSkeleton />}>
        <OverviewParts api={page.api} fleetId={page.fleetId} />
      </Suspense>
    </div>
  );
}
