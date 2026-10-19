import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID, SHIP_ID, memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { createFleetEndpoints } from './fleet-endpoints.js';

const SECRET = 'a-gateway-secret-of-at-least-32-characters';
const ISSUER = 'https://gateway.example.com';
const CREWED_AT = new Date('2026-10-19T09:00:00.000Z');

let connections: ReturnType<typeof memoryConnectionStore>;
let endpoints: ReturnType<typeof createFleetEndpoints>;

beforeEach(async () => {
  connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: CREWED_AT });
  endpoints = createFleetEndpoints({ secret: SECRET, issuer: ISSUER, connections });
});

describe("each fleet's MCP endpoint, at an alias of the fleet (interop 1: one fleet URL)", () => {
  it('serves a fleet at an alias of 8 lowercase letters and digits, the same each time, with no fleet id in it', () => {
    const endpoint = endpoints.endpointOf(FLEET_ID);

    expect(endpoint).toMatch(/^https:\/\/gateway\.example\.com\/fleets\/[a-z][a-z2-7]{7}\/mcp$/);
    expect(endpoints.endpointOf(FLEET_ID)).toBe(endpoint);
    expect(endpoint).not.toContain(FLEET_ID.slice('flt_'.length));
  });

  it('serves two fleets at two endpoints', () => {
    expect(endpoints.endpointOf(FLEET_ID)).not.toBe(endpoints.endpointOf(OTHER_FLEET_ID));
  });

  it('serves under the path of its public URL', () => {
    const served = createFleetEndpoints({ secret: SECRET, issuer: 'https://example.com/gw', connections });

    expect(served.endpointOf(FLEET_ID)).toMatch(/^https:\/\/example\.com\/gw\/fleets\/[a-z2-7]{8}\/mcp$/);
  });

  it('knows the fleet of its endpoint, among the fleets it is connected to', async () => {
    await expect(endpoints.fleetOf(endpoints.endpointOf(FLEET_ID))).resolves.toBe(FLEET_ID);
  });

  it.each([
    { what: "a fleet's endpoint it is not connected to", resource: () => endpoints.endpointOf(OTHER_FLEET_ID) },
    { what: 'another URL', resource: () => 'https://gateway.example.com/mcp' },
    { what: "another gateway's endpoint of the same fleet", resource: () => createFleetEndpoints({ secret: 'another-gateway-secret-of-32-characters-or-more', issuer: ISSUER, connections }).endpointOf(FLEET_ID) },
  ])('knows no fleet for $what', async ({ resource }) => {
    await expect(endpoints.fleetOf(resource())).resolves.toBeUndefined();
  });
});
