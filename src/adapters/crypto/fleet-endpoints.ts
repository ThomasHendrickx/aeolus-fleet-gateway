import { createHmac } from 'node:crypto';

import type { FleetId } from '@aeolus-fleet/common';

import type { ConnectionStore } from '../../core/connection/ports.js';
import type { FleetEndpoints } from '../../core/oauth/ports.js';

const ALIAS_LENGTH = 8;
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
/** Lowercase base32 (RFC 4648's alphabet): 32 divides 256, so each byte draws a character evenly. */
const BASE32 = `${LETTERS}234567`;

/** The path a fleet's MCP endpoint is served at, under the public URL's own path. */
export const FLEET_ENDPOINT_PATH = '/fleets/:alias/mcp';

/**
 * Each fleet's MCP endpoint, `<public URL>/fleets/<alias>/mcp`: the one URL
 * its MCP clients connect to (interop 1). The alias is an HMAC of the fleet
 * id under the gateway's secret, as ships' aliases are, so the URL names no
 * fleet id and stays the same across restarts. A fleet is found by its
 * endpoint among the fleets the gateway is connected to.
 */
export function createFleetEndpoints(deps: { secret: string; issuer: string; connections: ConnectionStore }): FleetEndpoints & { endpointOf(fleetId: FleetId): string } {
  const aliasOf = (fleetId: FleetId) => {
    const bytes = createHmac('sha256', deps.secret).update(`fleet:${fleetId}`).digest();
    return [...bytes.subarray(0, ALIAS_LENGTH)].map((byte, index) => (index === 0 ? LETTERS.charAt(byte % LETTERS.length) : BASE32.charAt(byte % BASE32.length))).join('');
  };
  const endpointOf = (fleetId: FleetId) => `${deps.issuer}${FLEET_ENDPOINT_PATH.replace(':alias', aliasOf(fleetId))}`;
  return {
    endpointOf,
    fleetOf: async (resource) => (await deps.connections.connected()).find((crew) => endpointOf(crew.fleetId) === resource)?.fleetId,
  };
}
