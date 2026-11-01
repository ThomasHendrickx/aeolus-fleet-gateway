import type { ActiveShips } from '../../core/people/ports.js';
import { ok } from '../../core/shared/result.js';
import { everyListedShip } from './every-listed-ship.js';

/**
 * The fleet's active ships as the actor reads them (fleet.list, decision
 * 0057), for Your fleet: retired ships are filtered out in the fleet's own
 * query, and each ship comes with its kind, its crew's report and its open
 * alerts.
 */
export function createActiveShips(fleetUrl: string): ActiveShips {
  return {
    list: async (as) => {
      const listed = await everyListedShip(fleetUrl, { as, filter: { status: ['awaitingCrew', 'crewed'] } });
      if (!listed.isOk) {
        return listed;
      }
      return ok(
        listed.value.flatMap(({ id, name, kind, status, report, openAlertCount }) =>
          // The filter asked for no retired ship; one answered anyway is left out.
          status === 'retired' ? [] : [{ shipId: id, name, kind, status, report: report === null ? null : { state: report.state, note: report.note }, openAlertCount }],
        ),
      );
    },
  };
}
