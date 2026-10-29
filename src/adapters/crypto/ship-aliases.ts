import { createHmac } from 'node:crypto';

import type { ShipAliases } from '../../core/mcp-in/ports.js';

const ALIAS_LENGTH = 8;
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
/** Lowercase base32 (RFC 4648's alphabet): 32 divides 256, so each byte draws a character evenly. */
const BASE32 = `${LETTERS}234567`;

/**
 * Aliases as an HMAC of the fleet and ship under the gateway's secret: the
 * same ship has the same alias across restarts, and nobody without the secret
 * learns its id from it. It starts with a letter, as a tool name may need.
 */
export function createShipAliases(secret: string): ShipAliases {
  return {
    aliasOf: (fleetId, shipId) => {
      const bytes = createHmac('sha256', secret).update(`${fleetId}:${shipId}`).digest();
      return [...bytes.subarray(0, ALIAS_LENGTH)].map((byte, index) => (index === 0 ? LETTERS.charAt(byte % LETTERS.length) : BASE32.charAt(byte % BASE32.length))).join('');
    },
  };
}
