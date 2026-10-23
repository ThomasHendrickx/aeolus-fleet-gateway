import type { EmailChannels } from '../../core/people/ports.js';
import type { Db } from './client.js';

/** The email channels people turned on, a row per person ship while it is on (wake a person, W8). */
export function createPrismaEmailChannels(db: Db): EmailChannels {
  return {
    isOn: async ({ fleetId, shipId }) => (await db.emailChannel.count({ where: { fleetId, shipId } })) > 0,
    turn: async ({ fleetId, shipId }, { isOn, at }) => {
      if (isOn) {
        await db.emailChannel.upsert({ where: { fleetId_shipId: { fleetId, shipId } }, create: { fleetId, shipId, turnedOnAt: at }, update: {} });
        return;
      }
      await db.emailChannel.deleteMany({ where: { fleetId, shipId } });
    },
  };
}
