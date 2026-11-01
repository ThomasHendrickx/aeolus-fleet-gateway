import { Ship } from 'lucide-react';

import { inFleet } from '../../../../lib/gateway-api/page-account';
import type { FleetRead } from '../hooks/read-your-fleet';
import { BRIDGE_FLEET_PATH } from '../paths';
import { shipsOf } from '../services/your-fleet';
import { FleetNumbers } from '../ui/fleet-numbers';
import { FleetUnreadable } from '../ui/fleet-unreadable';
import { FleetWall } from '../ui/fleet-wall';

/** What the phone's home shows of the fleet, as the mockups draw it: the numbers when nothing waits, nothing while something does. */
export type PhoneHome = 'numbers' | 'hidden';

/**
 * Your fleet beside Bridge home (home.html, states.html): the ship count,
 * the four numbers and a tile per ship in its group; the heading leads to the
 * whole fleet. Left out for an account the fleet does not let read it.
 */
export function YourFleetPanel({ fleetId, read, phone, isRecordUnreadable = false }: { fleetId: string; read: FleetRead; phone: PhoneHome; isRecordUnreadable?: boolean }) {
  // While the record cannot be read either, the banner over home says it, once and without core's words (states.html).
  if (read.kind === 'forbidden' || (read.kind === 'unreadable' && isRecordUnreadable)) {
    return null;
  }
  return (
    <section data-testid="bridge-your-fleet" className={`${phone === 'hidden' ? 'max-lg:hidden ' : ''}grid content-start gap-3`} aria-labelledby="bridge-your-fleet-heading">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="bridge-your-fleet-heading" className="text-section font-semibold">
          <a href={inFleet(BRIDGE_FLEET_PATH, fleetId)} className="inline-flex items-center gap-1.5 hover:underline">
            <Ship aria-hidden="true" className="size-4 shrink-0" />
            Your fleet
          </a>
        </h2>
        {read.kind === 'read' ? <span className="text-caption text-muted-foreground max-lg:hidden">{shipsOf(read.value.shipCount)}</span> : null}
      </div>
      {read.kind === 'read' ? (
        <>
          <FleetNumbers fleet={read.value} isShipCountShown={false} />
          <FleetWall className="max-lg:hidden" groups={read.value.groups} tileColumns="grid-cols-3" />
        </>
      ) : (
        <FleetUnreadable message={read.message} />
      )}
    </section>
  );
}
