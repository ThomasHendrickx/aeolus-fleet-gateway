import type { ProxyShipDoor } from '../../core/parties/ports.js';

/** The part of a logger this needs: a warning with its fields. */
interface WarningLog {
  warn(fields: Record<string, unknown>, message: string): void;
}

/**
 * The fleet's verified facts write, with a refusal logged as a warning: the
 * approval goes on without it (decision 0059), so the log is where a refused
 * write shows, as in a fleet whose own network rules give the gateway's ship
 * no manage reach over its proxy ships.
 */
export function logRefusedFacts(door: Pick<ProxyShipDoor, 'setVerifiedFacts'>, log: WarningLog): Pick<ProxyShipDoor, 'setVerifiedFacts'> {
  return {
    setVerifiedFacts: async (crewToken, written) => {
      const set = await door.setVerifiedFacts(crewToken, written);
      if (!set.isOk) {
        log.warn({ shipId: written.shipId, code: set.error.code, reason: set.error.message }, 'the fleet refused the verified facts about a proxy ship');
      }
      return set;
    },
  };
}
