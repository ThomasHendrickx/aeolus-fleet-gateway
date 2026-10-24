import type { WakesSent } from '../../core/people/ports.js';
import type { Db } from './client.js';

/** When each channel last woke each person ship, a row per ship and channel (wake a person, W3). */
export function createPrismaWakesSent(db: Db): WakesSent {
  return {
    lastSentAt: async ({ fleetId, shipId }, channel) => (await db.wakeSent.findUnique({ where: { fleetId_shipId_channel: { fleetId, shipId, channel } } }))?.sentAt,
    record: async ({ ship: { fleetId, shipId }, channel, sentAt }) => {
      await db.wakeSent.upsert({ where: { fleetId_shipId_channel: { fleetId, shipId, channel } }, create: { fleetId, shipId, channel, sentAt }, update: { sentAt } });
    },
  };
}
