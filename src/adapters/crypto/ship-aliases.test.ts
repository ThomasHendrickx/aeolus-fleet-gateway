import { describe, expect, it } from 'vitest';

import { createShipAliases } from './ship-aliases.js';

const FLEET = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const SHIP = 'shp_01m3tbfspe96yf1rnr4ank9cr2';

describe("a ship's alias, the only name of it an outside client sees (NAT both ways)", () => {
  it('is 8 lowercase letters and digits, the same for the same ship', () => {
    const aliases = createShipAliases('a-gateway-secret-of-at-least-32-characters');

    expect([aliases.aliasOf(FLEET, SHIP), aliases.aliasOf(FLEET, SHIP)].map((alias) => /^[a-z][a-z0-9]{7}$/.test(alias))).toEqual([true, true]);
    expect(aliases.aliasOf(FLEET, SHIP)).toBe(aliases.aliasOf(FLEET, SHIP));
  });

  it('differs per ship, per fleet and per gateway secret', () => {
    const aliases = createShipAliases('a-gateway-secret-of-at-least-32-characters');
    const others = [aliases.aliasOf(FLEET, 'shp_01m3tbfspe96yf1rnr4ank9cr3'), aliases.aliasOf('flt_01m3tb1zgr5h2ffee12xnch8zz', SHIP), createShipAliases('another-gateway-secret-of-32-characters!').aliasOf(FLEET, SHIP)];

    expect(new Set([aliases.aliasOf(FLEET, SHIP), ...others]).size).toBe(4);
  });
});
