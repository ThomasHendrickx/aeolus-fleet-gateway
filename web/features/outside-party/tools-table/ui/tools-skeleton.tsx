/** How many rows the table shows while the server's tools/list is read. */
const SKELETON_ROWS = 8;

/** The tools table's shape while the server's tools/list is read (gateway scopes 4.3). */
export function ToolsSkeleton({ party }: { party: string }) {
  return (
    <div aria-busy="true" aria-label={`Reading the tools ${party} lists`} className="grid gap-2" data-testid="tools-table-skeleton">
      <span className="block h-9 w-full animate-pulse rounded-md bg-muted" />
      {Array.from({ length: SKELETON_ROWS }, (_, row) => (
        <span key={row} className="block h-10 animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}
