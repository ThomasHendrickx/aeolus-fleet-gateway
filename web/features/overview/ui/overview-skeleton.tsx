function Bar({ width }: { width: string }) {
  return <span className={`block h-4 animate-pulse rounded bg-muted ${width}`} />;
}

/** The Overview's shape while it loads: the lead, then a list. */
export function OverviewSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the Overview" className="grid gap-6">
      <div className="flex items-center gap-4">
        <span className="size-12 animate-pulse rounded-full bg-muted" />
        <div className="grid flex-1 gap-2">
          <Bar width="w-48" />
          <Bar width="w-32" />
        </div>
      </div>
      <div className="grid gap-2">
        {['a', 'b', 'c'].map((row) => (
          <span key={row} className="block h-14 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    </div>
  );
}
