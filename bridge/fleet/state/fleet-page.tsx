import type { FleetRead } from '../../../web/features/bridge/fleet/hooks/read-your-fleet';
import { FleetUnreadable } from '../../../web/features/bridge/fleet/ui/fleet-unreadable';
import { harbourOf, summaryOf } from '../services/your-fleet';
import { BridgeHarbour } from '../ui/bridge-harbour';

/**
 * The phone's Fleet tab, and where Your fleet's heading leads on any screen:
 * Harbour from @aeolus-fleet/ui (aeolus-fleet docs/design/fleet-overview).
 * On the phone its top bar says Fleet, straight to the numbers; on a wider
 * screen headed Your fleet with Harbour's lead line; then a tile per ship in
 * its group.
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
        <BridgeHarbour {...harbourOf(read.value)} consoleUrl={consoleUrl} now={new Date()} />
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
