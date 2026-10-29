import { requestStatus, subjectKind, subjectName, type ShownRequest } from '../services/requests';
import { StatusBadge } from './status-badge';

function PartyMark({ name }: { name: string }) {
  return (
    <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary font-semibold text-secondary-foreground">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function RequestRow({ request, now }: { request: ShownRequest; now: Date }) {
  const name = subjectName(request);
  return (
    <>
      <PartyMark name={name} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{name}</span>
        <span className="text-caption text-muted-foreground">{subjectKind(request)}</span>
      </span>
      <StatusBadge status={requestStatus(request, now)} />
    </>
  );
}

/** Requests in a list: each a link to decide it, or, for the person's own, its state alone. */
export function RequestsList({ title, requests, now, hrefOf, currentId }: { title: string; requests: readonly ShownRequest[]; now: Date; hrefOf?: (request: ShownRequest) => string; currentId?: string }) {
  return (
    <section className="grid gap-2">
      <h2 className="text-section font-semibold">
        {title} · {requests.length}
      </h2>
      {requests.map((request) =>
        hrefOf === undefined ? (
          <div key={request.requestId} className="flex items-center gap-3 rounded-md border border-border bg-card p-3">
            <RequestRow request={request} now={now} />
          </div>
        ) : (
          <a
            key={request.requestId}
            href={hrefOf(request)}
            aria-current={request.requestId === currentId ? 'true' : undefined}
            data-testid="overview-request"
            className="flex items-center gap-3 rounded-md border border-border bg-card p-3 hover:bg-accent aria-[current=true]:border-ring"
          >
            <RequestRow request={request} now={now} />
          </a>
        ),
      )}
    </section>
  );
}
