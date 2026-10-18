import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../../src/core/connection/ports.js';
import type { Party } from '../../src/core/parties/party.js';
import type { PartyStore, ProxyShipDoor } from '../../src/core/parties/ports.js';
import { err, ok, type Result } from '../../src/core/shared/result.js';

export const OWNER_SHIP_ID: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9wnr';
export const PROXY_SHIP_ID: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9crm';

/** The parties in memory, by fleet and name. */
export function memoryPartyStore(): PartyStore & { held: Map<string, Party> } {
  const held = new Map<string, Party>();
  const key = (fleetId: FleetId, name: string) => `${fleetId}/${name}`;
  return {
    held,
    find: (fleetId, name) => Promise.resolve(held.get(key(fleetId, name))),
    list: (fleetId) => Promise.resolve([...held.values()].filter((party) => party.fleetId === fleetId)),
    save: (party) => {
      held.set(key(party.fleetId, party.name), party);
      return Promise.resolve();
    },
    remove: (fleetId, name) => {
      held.delete(key(fleetId, name));
      return Promise.resolve();
    },
  };
}

/**
 * A fleet that commissions the gateway's app ships as core does (#959): once
 * per idempotency key, its secret only on the first commission, owned by an
 * active person's ship or argo; and lets the secret claim the ship once.
 */
export function fakeProxyShipFleet() {
  const state = {
    isAnswering: true,
    /** Whether a register is answered; the fleet may answer the commission and then go quiet. */
    isRegisterAnswering: true,
    validOwners: new Set<ShipId>([OWNER_SHIP_ID]),
    commissioned: new Array<{ name: string; type: string; owner: ShipId; idempotencyKey: string }>(),
    keys: new Map<string, ShipId>(),
    secrets: new Map<ShipId, string>(),
    crewed: new Set<ShipId>(),
    /** Dies after the next commission is stored, before its answer arrives. */
    isLosingNextAnswer: false,
  };
  const unavailable = (): Promise<Result<never, FleetRefusal>> => Promise.resolve(err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' }));
  const door: ProxyShipDoor = {
    commissionAppShip: (_crewToken, ship) => {
      if (!state.isAnswering) {
        return unavailable();
      }
      if (!state.validOwners.has(ship.owner)) {
        return Promise.resolve(err({ code: 'BAD_REQUEST', message: 'The owner is an active person ship or argo (decision 0045)' }));
      }
      const earlier = state.keys.get(ship.idempotencyKey);
      if (earlier !== undefined) {
        return Promise.resolve(ok({ shipId: earlier, secret: null }));
      }
      state.commissioned.push(ship);
      state.keys.set(ship.idempotencyKey, PROXY_SHIP_ID);
      state.secrets.set(PROXY_SHIP_ID, 'aeolus_sk_v1_proxy');
      if (state.isLosingNextAnswer) {
        state.isLosingNextAnswer = false;
        return unavailable();
      }
      return Promise.resolve(ok({ shipId: PROXY_SHIP_ID, secret: 'aeolus_sk_v1_proxy' }));
    },
    register: ({ shipId, secret }) => {
      if (!state.isAnswering || !state.isRegisterAnswering) {
        return unavailable();
      }
      if (state.secrets.get(shipId) !== secret || state.crewed.has(shipId)) {
        return Promise.resolve(err({ code: 'UNAUTHORIZED', message: 'Wrong ship id or secret' }));
      }
      state.crewed.add(shipId);
      return Promise.resolve(ok({ crewToken: 'aeolus_ct_v1_proxy' }));
    },
  };
  return { state, door };
}
