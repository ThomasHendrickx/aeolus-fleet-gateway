import { signedInPage, type SearchParams } from '../../../lib/gateway-api/page-api';
import { OVERVIEW_PATH, readRequestToDecide } from '../hooks/read-overview';
import { NoSignIn } from '../../sign-in/ui/no-sign-in';
import { subjectKind, subjectName } from '../services/requests';
import { RequestsList } from '../ui/requests-list';
import { DecisionPanel } from './decision-panel';
import { LiveRefresh } from './live-refresh';

/**
 * One request to decide, with its decision beside the queue (decision
 * 0056). The queue stays live; a request decided elsewhere meanwhile no
 * longer waits here.
 */
export async function RequestToDecide({ requestId, searchParams }: { requestId: string; searchParams: SearchParams }) {
  const page = await signedInPage({ path: `${OVERVIEW_PATH}/requests/${encodeURIComponent(requestId)}`, searchParams });
  if (page.kind === 'noSignIn') {
    return <NoSignIn />;
  }
  const { fleetId, scopes } = page;
  const { request, toDecide } = await readRequestToDecide(page.api, requestId);
  const overview = `/overview?fleet=${encodeURIComponent(fleetId)}`;
  const queue = (
    <RequestsList title="Queue" requests={toDecide} now={new Date()} currentId={requestId} hrefOf={(other) => `/overview/requests/${encodeURIComponent(other.requestId)}?fleet=${encodeURIComponent(fleetId)}`} />
  );
  if (request === undefined) {
    return (
      <div className="grid gap-6">
        <LiveRefresh fleetId={fleetId} />
        <section data-testid="overview-no-longer-waits" className="rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
          <h2 className="text-heading font-semibold">This request no longer waits for a decision</h2>
          <div className="mt-4">
            <a href={overview} className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-primary-foreground hover:bg-primary-hover">
              Back to the Overview
            </a>
          </div>
        </section>
      </div>
    );
  }
  const requesters = request.requesters.length;
  return (
    <div className="grid gap-6">
      <LiveRefresh fleetId={fleetId} />
      <h1 className="text-heading font-semibold">To decide</h1>
      <div className="grid gap-6 md:grid-cols-[1fr_18rem]">
        <div className="grid content-start gap-4">
          <section className="grid justify-items-center gap-1 rounded-lg border border-border bg-card p-6 text-center">
            <span className="text-section font-semibold">{subjectName(request)}</span>
            <span className="text-caption text-muted-foreground">
              {subjectKind(request)} · {requesters} {requesters === 1 ? 'requester' : 'requesters'}
            </span>
          </section>
          <DecisionPanel fleetId={fleetId} request={request} heldScopes={scopes} />
        </div>
        <aside>{queue}</aside>
      </div>
    </div>
  );
}
