/** Your fleet cannot be read now: why, in one line; the rest of the page stands. */
export function FleetUnreadable({ message }: { message: string }) {
  return (
    <p role="status" data-testid="fleet-unreadable" className="grid gap-0.5 rounded-md border border-border bg-card px-3 py-2 text-caption">
      <span className="font-semibold">Your fleet cannot be read now</span>
      <span className="text-muted-foreground">{message}</span>
    </p>
  );
}
