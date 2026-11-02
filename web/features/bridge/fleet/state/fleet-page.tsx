import type { FleetRead } from '../hooks/read-your-fleet';
import { summaryOf } from '../services/your-fleet';
import { FleetNumbers } from '../ui/fleet-numbers';
import { FleetUnreadable } from '../ui/fleet-unreadable';
import { FleetWall } from '../ui/fleet-wall';

/**
 * The phone's Fleet tab, and where Your fleet's heading leads on any screen,
 * as Harbour draws it (docs/design/fleet-overview): on the phone its top
 * bar says Fleet, straight to the ships and the four numbers; on a wider screen
 * headed Your fleet with Harbour's lead line; then a tile per ship in its
 * group.
 */
export function FleetPage({ read, consoleUrl }: { read: FleetRead; consoleUrl: string | undefined }) {
  return (
    <section className="grid gap-4" aria-labelledby="bridge-fleet-heading">
      <div className="max-sm:sr-only">
        <h1 id="bridge-fleet-heading" className="text-heading-touch font-semibold">
          Your fleet
        </h1>
        {read.kind === 'read' ? <p className="max-sm:hidden text-muted-foreground">{summaryOf(read.value)}</p> : null}
      </div>
      {read.kind === 'read' ? (
        <>
          <FleetNumbers fleet={read.value} isShipCountShown />
          <FleetWall groups={read.value.groups} consoleUrl={consoleUrl} tileColumns="grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(12rem,1fr))]" now={new Date()} />
        </>
      ) : read.kind === 'unreadable' ? (
        <FleetUnreadable message={read.message} />
      ) : (
        <p data-testid="fleet-forbidden" className="text-muted-foreground">
          Your account may not read the fleet&apos;s ships.
        </p>
      )}
    </section>
  );
}
