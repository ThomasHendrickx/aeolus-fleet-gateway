import { discoverOutputSchema } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';

import { createRestFleetDoor } from '../src/adapters/fleet/rest-fleet-door.js';
import { commission, register, signIn } from './support/argo.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';

// The gateway's ship writes what it checked about a proxy ship it
// commissioned, with fleet:verify (decision 0059), and a ship that discovers
// the proxy ship reads it beside its statement, naming the gateway.

const GATEWAY_SCOPES = ['fleet:read', 'fleet:commission', 'fleet:on-behalf', 'scopes:declare', 'fleet:verify'];
const TLS_HOST = [{ checked: 'tlsHost', value: 'crm.example.com' }] as const;

let fleet: FleetServer;
let cookie: string;

beforeEach(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  cookie = await signIn(fleet);
});

afterEach(async () => {
  await fleet.stop();
});

/** The gateway's ship, crewed, and the proxy ship it commissioned for a person. */
async function aProxyShip() {
  const door = createRestFleetDoor(fleet.url);
  const gateway = await commission(fleet, { cookie, ship: { name: 'gateway', type: 'gateway', kind: 'app', scopes: GATEWAY_SCOPES } });
  const gatewayCrewToken = await register(fleet, gateway);
  const owner = await commission(fleet, { cookie, ship: { name: 'person-charlotte', type: 'person', kind: 'person' } });
  const commissioned = await door.commissionAppShip(gatewayCrewToken, { name: 'crm', type: 'mcp-server', owner: owner.shipId, idempotencyKey: 'approve-crm', scopes: [] });
  if (!commissioned.isOk) {
    throw new Error(commissioned.error.message);
  }
  return { door, gateway, gatewayCrewToken, proxyShipId: commissioned.value.shipId };
}

/** What a ship of the fleet discovers. */
async function discovered() {
  const reader = await commission(fleet, { cookie, ship: { name: 'agent', type: 'agent', scopes: ['messages:send'] } });
  const response = await fetch(`${fleet.url}/api/v1/ship/discover`, { headers: { authorization: `Bearer ${await register(fleet, reader)}` } });
  return discoverOutputSchema.parse(await response.json());
}

describe("the gateway's ship writes what it checked about a proxy ship (decision 0059)", () => {
  it('is taken, and a ship that discovers the proxy ship reads it, written by the gateway', async () => {
    const { door, gateway, gatewayCrewToken, proxyShipId } = await aProxyShip();

    await expect(door.setVerifiedFacts(gatewayCrewToken, { shipId: proxyShipId, facts: TLS_HOST })).resolves.toEqual({ isOk: true, value: undefined });

    const { ships } = await discovered();
    expect(ships.find(({ id }) => id === proxyShipId)?.verified).toMatchObject([{ checked: 'tlsHost', value: 'crm.example.com', by: { kind: 'ship', id: gateway.shipId, name: 'gateway' } }]);
  });
});
