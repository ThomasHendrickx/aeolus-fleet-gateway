/**
 * What waits on the person, counted: deliveries for them and requests to
 * decide. A count they have no part in is left out; with neither, nothing
 * waits on them.
 */
export function OverviewLead({ waiting, toDecide }: { waiting: number | undefined; toDecide: number | undefined }) {
  if (waiting === undefined && toDecide === undefined) {
    return <h1 className="text-heading font-semibold">Nothing waits on you</h1>;
  }
  const total = (waiting ?? 0) + (toDecide ?? 0);
  const counts = [waiting === undefined ? undefined : `${String(waiting)} for you`, toDecide === undefined ? undefined : `${String(toDecide)} to decide`].filter((count) => count !== undefined);
  return (
    <div className="flex items-center gap-4">
      <span data-testid="overview-total" className="inline-flex size-12 items-center justify-center rounded-full border-4 border-tone-waiting-border text-section font-semibold">
        {total}
      </span>
      <div>
        <h1 className="text-heading font-semibold">{total === 0 ? 'Nothing waits on you' : 'Waits on you'}</h1>
        <p className="text-muted-foreground">{counts.join(' · ')}</p>
      </div>
    </div>
  );
}
