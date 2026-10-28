import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aSlackApp, fakeProxyShipKinds, fakeSlackShips, memorySlackApps } from '../../../test/support/slack-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import { ok } from '../shared/result.js';
import { createListExposable } from './list-exposable.js';

// Expose a ship… offers the agent ships and outside A2A agents' proxy ships
// the actor reads, not yet bots and not retired (gateway scopes 9.2, P-B3);
// manage reach is the fleet's to answer when the actor exposes one.

const ANA: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc-ana', personShipId: null, accountToken: 'account-token-ana', scopes: ['gateway:slack'] };

describe('the ships Expose offers', () => {
  it('are the agent ships and A2A agents\' proxy ships, not yet bots, not retired, by name', async () => {
    const ships = fakeSlackShips([
      { shipId: 'shp_01m3tbfspe96yf1rnr4ank9r1n', name: 'release-notes', kind: 'agent', status: 'crewed', summary: null },
      { shipId: 'shp_01m3tbfspe96yf1rnr4ank9b0d', name: 'budget-check', kind: 'agent', status: 'awaitingCrew', summary: null },
      { shipId: 'shp_01m3tbfspe96yf1rnr4ank9q0t', name: 'quotes', kind: 'app', status: 'crewed', summary: null },
      { shipId: 'shp_01m3tbfspe96yf1rnr4ank9c0m', name: 'crm', kind: 'app', status: 'crewed', summary: null },
      { shipId: 'shp_01m3tbfspe96yf1rnr4ank9c4r', name: 'charlotte', kind: 'person', status: 'crewed', summary: null },
      { shipId: 'shp_01m3tbfspe96yf1rnr4ank9o1d', name: 'old-writer', kind: 'agent', status: 'retired', summary: null },
      { shipId: 'shp_01m3tbfspe96yf1rnr4ank9e0x', name: 'exposed', kind: 'agent', status: 'crewed', summary: null },
    ]);
    const apps = memorySlackApps();
    await apps.save(aSlackApp({ appId: 'A02', shipId: 'shp_01m3tbfspe96yf1rnr4ank9e0x' }));

    const listed = await createListExposable({ ships: ships.port, apps, proxyShips: fakeProxyShipKinds({ shp_01m3tbfspe96yf1rnr4ank9q0t: 'a2aAgent', shp_01m3tbfspe96yf1rnr4ank9c0m: 'mcpServer' }), credentialOf: (_actor, sent) => Promise.resolve(ok(sent)) })({ actor: ANA, as: {} });

    expect(listed).toEqual({
      isOk: true,
      value: [
        { shipId: 'shp_01m3tbfspe96yf1rnr4ank9b0d', name: 'budget-check' },
        { shipId: 'shp_01m3tbfspe96yf1rnr4ank9q0t', name: 'quotes' },
        { shipId: 'shp_01m3tbfspe96yf1rnr4ank9r1n', name: 'release-notes' },
      ],
    });
  });
});
