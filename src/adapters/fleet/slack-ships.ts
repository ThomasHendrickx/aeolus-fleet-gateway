import type { FleetId } from '@aeolus-fleet/common';
import { shipOutputSchema } from '@aeolus-fleet/common';

import type { FleetShips, ProxyShipsAsActor } from '../../core/parties/ports.js';
import { err, ok } from '../../core/shared/result.js';
import type { SlackShips } from '../../core/slack/ports.js';
import { readAs } from './actor-door.js';

/**
 * The fleet's ships as Slack's part of the gateway reads them: a ship as
 * the gateway's ship of its fleet reads it (fleet.ship), with what it is and
 * its statement's summary; the ships an actor reads; and whether it manages
 * one, asked as the actor.
 */
export function createSlackShips(deps: { fleetUrl: string; crewTokenOf: (fleetId: FleetId) => Promise<string | undefined>; ships: FleetShips; asActor: Pick<ProxyShipsAsActor, 'checkManage'> }): SlackShips {
  return {
    read: async (fleetId, shipId) => {
      const crewToken = await deps.crewTokenOf(fleetId);
      if (crewToken === undefined) {
        return err({ code: 'UNAVAILABLE', message: 'The gateway is not connected to this fleet' });
      }
      const read = await readAs(deps.fleetUrl, { as: { crewToken }, procedure: 'ship', input: { shipId } });
      if (!read.isOk) {
        return read;
      }
      const ship = shipOutputSchema.safeParse(read.value);
      if (!ship.success || 'isInReadReach' in ship.data) {
        return err({ code: 'UNAVAILABLE', message: 'The fleet answered no ship' });
      }
      const { id, name, kind, status, statement } = ship.data;
      return ok({ shipId: id, name, kind, status, summary: statement?.by === 'crew' ? statement.summary : null });
    },
    list: (as) => deps.ships.list(as),
    checkManage: (as, shipId) => deps.asActor.checkManage(as, { shipId }),
  };
}
