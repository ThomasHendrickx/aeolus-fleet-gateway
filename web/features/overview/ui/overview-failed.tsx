/** The Overview could not be read: why, and the way to try again. */
export function OverviewFailed({ message, onTryAgain }: { message: string; onTryAgain: () => void }) {
  return (
    <section role="alert" className="rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
      <h2 className="text-heading font-semibold">The Overview could not be read</h2>
      <p data-testid="overview-failed-reason" className="mt-2 text-muted-foreground">
        {message === '' ? 'The gateway did not answer.' : message} Try again in a moment.
      </p>
      <div className="mt-4">
        <button type="button" onClick={onTryAgain} className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-primary-foreground hover:bg-primary-hover">
          Try again
        </button>
      </div>
    </section>
  );
}
