import type { OutsidePartySwitches } from '../../core/outside-parties/ports.js';
import type { Db } from './client.js';

/** Each fleet's outside parties switch, one row per fleet once set. */
export function createPrismaOutsidePartySwitches(db: Db): OutsidePartySwitches {
  return {
    isOn: async (fleetId) => (await db.outsidePartySwitch.findUnique({ where: { fleetId } }))?.isOn === true,
    set: async (fleetId, { isOn, at }) => {
      await db.outsidePartySwitch.upsert({ where: { fleetId }, create: { fleetId, isOn, changedAt: at }, update: { isOn, changedAt: at } });
    },
  };
}
