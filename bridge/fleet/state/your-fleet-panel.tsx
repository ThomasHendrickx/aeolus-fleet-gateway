import { HarbourNumbers } from '@aeolus-fleet/ui';
import { Ship } from 'lucide-react';

import type { FleetRead } from '../../../web/features/bridge/fleet/hooks/read-your-fleet';
import { BRIDGE_FLEET_PATH } from '../../../web/features/bridge/fleet/paths';
import { FleetUnreadable } from '../../../web/features/bridge/fleet/ui/fleet-unreadable';
import { inFleet } from '../../../web/lib/gateway-api/page-account';
import { harbourOf } from '../services/your-fleet';
import { BridgeHarbour } from '../ui/bridge-harbour';

/** What the phone's home shows of the fleet, as the mockups draw it: the numbers when nothing waits, nothing while something does. */
export type PhoneHome = 'numbers' | 'hidden';

/**
 * Your fleet beside Bridge home: Harbour from @aeolus-fleet/ui at Bridge's
 * width, its numbers and a tile per ship in its group (aeolus-fleet
 * docs/design/fleet-overview, bridge-your-fleet); the heading leads to the
 * whole fleet. The phone's home shows the numbers alone. Left out for an
 * account the fleet does not let read it.
 */
export function YourFleetPanel({ fleetId, consoleUrl, read, phone, isRecordUnreadable = false }: { fleetId: string; consoleUrl: string | undefined; read: FleetRead; phone: PhoneHome; isRecordUnreadable?: boolean }) {
  // While the record cannot be read either, the banner over home says it, once and without core's words (states.html).
  if (read.kind === 'forbidden' || (read.kind === 'unreadable' && isRecordUnreadable)) {
    return null;
  }
  const harbour = read.kind === 'read' ? harbourOf(read.value) : undefined;
  return (
    <section data-testid="bridge-your-fleet" className={`${phone === 'hidden' ? 'max-lg:hidden ' : ''}grid content-start gap-3`} aria-labelledby="bridge-your-fleet-heading">
      <h2 id="bridge-your-fleet-heading" className="text-section font-semibold">
        <a href={inFleet(BRIDGE_FLEET_PATH, fleetId)} className="inline-flex items-center gap-1.5 hover:underline">
          <Ship aria-hidden="true" className="size-4 shrink-0" />
          Your fleet
        </a>
      </h2>
      {harbour === undefined ? (
        <FleetUnreadable message={read.kind === 'unreadable' ? read.message : ''} />
      ) : (
        <>
          <div className="lg:hidden">
            <HarbourNumbers counts={harbour.counts} />
          </div>
          <div className="max-lg:hidden">
            <BridgeHarbour counts={harbour.counts} groups={harbour.groups} consoleUrl={consoleUrl} now={new Date()} />
          </div>
        </>
      )}
    </section>
  );
}
