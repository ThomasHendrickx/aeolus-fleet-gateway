import type { ShipId } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../../src/core/connection/ports.js';
import type { AccountDoor, PersonCrew, PersonCrews } from '../../src/core/people/ports.js';
import { err, ok, type Result } from '../../src/core/shared/result.js';

/**
 * The fleet as a person ship sees it in a test (core 0.28, aeolus-fleet
 * #990): an account gets a starting prompt for its own person ship, and
 * releases it, with its token beside the gateway's crew token; a session
 * registers with the prompt's secret. Every call is recorded.
 */
export function fakePersonShipFleet(options: { personShipId: ShipId; isCrewedElsewhere?: boolean }) {
  const calls: string[] = [];
  const state = { isCrewed: options.isCrewedElsewhere === true, issued: 0, calls };
  const isOwn = (call: { crewToken: string; accountToken: string; shipId: ShipId }) => call.crewToken === 'aeolus_ct_v1_gateway' && call.accountToken === 'account-token-1' && call.shipId === options.personShipId;
  const forbidden: FleetRefusal = { code: 'FORBIDDEN', message: 'is not your person ship' };
  const door: AccountDoor & { register(claim: { shipId: ShipId; secret: string }): Promise<Result<{ crewToken: string }, FleetRefusal>> } = {
    startingPrompt: async (call) => {
      state.calls.push(`startingPrompt ${call.shipId}`);
      await Promise.resolve();
      if (!isOwn(call)) {
        return err(forbidden);
      }
      if (state.isCrewed) {
        return err({ code: 'CONFLICT', message: 'is crewed: release it first' });
      }
      state.issued += 1;
      return ok({ secret: `secret-${String(state.issued)}` });
    },
    release: async (call) => {
      state.calls.push(`release ${call.shipId}`);
      await Promise.resolve();
      if (!isOwn(call)) {
        return err(forbidden);
      }
      state.isCrewed = false;
      return ok(undefined);
    },
    register: async ({ shipId, secret }) => {
      state.calls.push(`register ${shipId}`);
      await Promise.resolve();
      if (secret !== `secret-${String(state.issued)}` || state.isCrewed) {
        return err({ code: 'UNAUTHORIZED', message: 'secret refused' });
      }
      state.isCrewed = true;
      return ok({ crewToken: `aeolus_ct_v1_person_${String(state.issued)}` });
    },
  };
  return { door, state };
}

export function memoryPersonCrews(): PersonCrews & { held: PersonCrew[] } {
  const held: PersonCrew[] = [];
  return {
    held,
    find: (fleetId, shipId) => Promise.resolve(held.find((crew) => crew.fleetId === fleetId && crew.shipId === shipId)),
    save: (crew) => {
      held.push(crew);
      return Promise.resolve();
    },
  };
}
