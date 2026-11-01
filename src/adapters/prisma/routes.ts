import { ITEM_JOBS, ROUTING_PLACES, type Route, type Routes } from '../../core/people/routing.js';
import type { Db } from './client.js';

/** Each person's own choice of where a job shows besides Bridge, a row per person ship, job and place (Bridge, section 8). */
export function createPrismaRoutes(db: Db): Routes {
  return {
    list: async ({ fleetId, shipId }) => {
      const rows = await db.route.findMany({ where: { fleetId, shipId } });
      // A row naming a job or place the gateway no longer knows routes nothing.
      return rows.flatMap((row): Route[] => {
        const job = ITEM_JOBS.find((each) => each === row.job);
        const place = ROUTING_PLACES.find((each) => each === row.place);
        return job === undefined || place === undefined ? [] : [{ fleetId, shipId, job, place, isOn: row.isOn, changedAt: row.changedAt }];
      });
    },
    save: async ({ fleetId, shipId, job, place, isOn, changedAt }) => {
      await db.route.upsert({ where: { fleetId_shipId_job_place: { fleetId, shipId, job, place } }, create: { fleetId, shipId, job, place, isOn, changedAt }, update: { isOn, changedAt } });
    },
  };
}
