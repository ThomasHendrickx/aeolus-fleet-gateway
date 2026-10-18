import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetDoor, FleetRefusal, GatewayBinding, GatewayCrew } from '../../src/core/connection/ports.js';
import { err, ok, type Result } from '../../src/core/shared/result.js';

export const SHIP_ID: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h1a';
export const FLEET_ID: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
export const OTHER_FLEET_ID: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';

/** The scopes argo gives the gateway's ship when it connects the gateway. */
export const GATEWAY_SCOPES = ['messages:send', 'messages:receive', 'fleet:read', 'fleet:commission', 'fleet:on-behalf', 'labels:assign'];

/**
 * A fleet that knows the gateway's ship: its secret claims it once, its crew
 * tokens work while their lease holds, and it has the scopes it was given.
 * It has a registered networking plugin or none, as the fleet answers it.
 */
export function fakeGatewayFleet() {
  const state = {
    secret: 'aeolus_sk_v1_good',
    fleetId: FLEET_ID,
    scopes: [...GATEWAY_SCOPES],
    hasNetworkingPlugin: true,
    isCrewed: false,
    isAnswering: true,
    liveTokens: new Set<string>(),
    registers: 0,
    deregistered: new Array<string>(),
  };
  const unavailable = () => Promise.resolve(err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' }));
  const released = () => Promise.resolve(err({ code: 'LEASE_ENDED', message: 'This ship was released; this session no longer crews it.' }));
  const door: FleetDoor = {
    register: ({ shipId, secret }): Promise<Result<{ crewToken: string }, FleetRefusal>> => {
      if (!state.isAnswering) {
        return unavailable();
      }
      state.registers += 1;
      if (shipId !== SHIP_ID || secret !== state.secret) {
        return Promise.resolve(err({ code: 'UNAUTHORIZED', message: 'Wrong ship id or secret' }));
      }
      if (state.isCrewed) {
        return Promise.resolve(err({ code: 'CONFLICT', message: 'The ship is crewed by another session' }));
      }
      state.isCrewed = true;
      const crewToken = `aeolus_ct_v1_${String(state.registers)}`;
      state.liveTokens.add(crewToken);
      return Promise.resolve(ok({ crewToken }));
    },
    whoami: (crewToken) => {
      if (!state.isAnswering) {
        return unavailable();
      }
      return state.liveTokens.has(crewToken) ? Promise.resolve(ok({ shipId: SHIP_ID, fleetId: state.fleetId, name: 'gateway', type: 'gateway' })) : released();
    },
    getShip: (crewToken) => {
      if (!state.isAnswering) {
        return unavailable();
      }
      return state.liveTokens.has(crewToken) ? Promise.resolve(ok({ status: 'crewed' as const, scopes: [...state.scopes] })) : released();
    },
    deregister: (crewToken) => {
      state.deregistered.push(crewToken);
      state.liveTokens.delete(crewToken);
      state.isCrewed = false;
      return Promise.resolve(ok(undefined));
    },
    hasNetworkingPlugin: (crewToken) => {
      if (!state.isAnswering) {
        return unavailable();
      }
      return state.liveTokens.has(crewToken) ? Promise.resolve(ok(state.hasNetworkingPlugin)) : released();
    },
  };
  return { state, door };
}

/** The gateway's connections in memory: a crew per fleet, and the binding kept when its crew token is dropped. */
export function memoryConnectionStore(): ConnectionStore & { held: Map<FleetId, GatewayCrew> } {
  const held = new Map<FleetId, GatewayCrew>();
  const bindings = new Map<FleetId, GatewayBinding>();
  return {
    held,
    find: (fleetId) => Promise.resolve(held.get(fleetId)),
    binding: (fleetId) => Promise.resolve(bindings.get(fleetId)),
    connected: () => Promise.resolve([...held.values()]),
    save: (crew) => {
      held.set(crew.fleetId, crew);
      bindings.set(crew.fleetId, { fleetId: crew.fleetId, shipId: crew.shipId });
      return Promise.resolve();
    },
    drop: (fleetId) => {
      held.delete(fleetId);
      return Promise.resolve();
    },
  };
}
