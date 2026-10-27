import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aSlackApp, aSlackWorkspace, fakeSlackShips, memorySlackApps, memorySlackWorkspaces } from '../../../test/support/slack-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import { createReadSlack } from './read-slack.js';

// The Slack page (gateway scopes 9.6): the workspace and its configuration
// token's state, the gateway's bot. Actors holding gateway:slack change it;
// others see the same state, read-only.

const NOW = new Date('2026-10-27T09:00:00.000Z');
const HOLDER: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc-charlotte', personShipId: 'shp_01m3tbfspe96yf1rnr4ank9c4r', accountToken: 'account-token-1', scopes: ['gateway:slack'] };
const READER: Actor = { ...HOLDER, scopes: ['fleet:read'] };
const BOT = { fleetId: FLEET_ID, appId: 'A01', shipId: null, clientId: 'c', clientSecret: 's', signingSecret: 'g', installUrl: 'https://slack.com/i', name: 'Acme', madeAt: NOW, installStartedAt: null, removedInSlackAt: null, bot: null };

let workspaces: ReturnType<typeof memorySlackWorkspaces>;
let apps: ReturnType<typeof memorySlackApps>;

beforeEach(() => {
  workspaces = memorySlackWorkspaces();
  apps = memorySlackApps();
});

const RELEASE_NOTES = { shipId: 'shp_01m3tbfspe96yf1rnr4ank9r1n', name: 'release-notes', kind: 'agent', status: 'crewed', summary: null } as const;
const QUOTES = { shipId: 'shp_01m3tbfspe96yf1rnr4ank9q0t', name: 'quotes', kind: 'app', status: 'crewed', summary: null } as const;
let ships: ReturnType<typeof fakeSlackShips>;

beforeEach(() => {
  ships = fakeSlackShips([RELEASE_NOTES, QUOTES]);
});

function readSlack(actor: Actor) {
  return createReadSlack({ workspaces, apps, ships: ships.port })(actor);
}

describe('the Slack page', () => {
  it('shows a fleet connected to no workspace, and whether the actor may connect one', async () => {
    await expect(Promise.all([readSlack(HOLDER), readSlack(READER)])).resolves.toEqual([
      { state: 'notConnected', canChange: true },
      { state: 'notConnected', canChange: false },
    ]);
  });

  it("shows the workspace, who connected it, a fresh token and the gateway's bot made but not installed", async () => {
    await workspaces.save(aSlackWorkspace());
    await apps.save(BOT);

    await expect(readSlack(HOLDER)).resolves.toEqual({
      state: 'connected',
      workspace: { teamId: 'T0ACME', name: null },
      connectedBy: 'charlotte',
      connectedAt: new Date('2026-10-27T08:00:00.000Z'),
      tokenState: 'fresh',
      gatewayBot: 'made',
      bots: [],
      canChange: true,
    });
  });

  it("shows each exposed ship by its id with its bot's state, both names while a rename waits for Slack, and the ship's name gone from the fleet as the bot's", async () => {
    await workspaces.save(aSlackWorkspace());
    await apps.save(aSlackApp({ appId: 'A02', shipId: RELEASE_NOTES.shipId, name: 'changelog', installStartedAt: NOW }));
    await apps.save(aSlackApp({ appId: 'A03', shipId: QUOTES.shipId, name: 'quotes', bot: { token: 'xoxb-3', userId: 'U03' } }));
    await apps.save(aSlackApp({ appId: 'A04', shipId: 'shp_01m3tbfspe96yf1rnr4ank9g0n', name: 'gone', bot: { token: 'xoxb-4', userId: 'U04' }, removedInSlackAt: NOW }));

    await expect(readSlack(HOLDER)).resolves.toMatchObject({
      bots: [
        { appId: 'A02', shipId: RELEASE_NOTES.shipId, shipName: 'release-notes', botName: 'changelog', state: 'waitingForInstall' },
        { appId: 'A03', shipId: QUOTES.shipId, shipName: 'quotes', botName: 'quotes', state: 'inSlack' },
        { appId: 'A04', shipId: 'shp_01m3tbfspe96yf1rnr4ank9g0n', shipName: 'gone', botName: 'gone', state: 'removedInSlack' },
      ],
    });
  });

  it("shows a refused token, and the gateway's bot installed, to a reader too", async () => {
    await workspaces.save(aSlackWorkspace({ teamName: 'Acme', isTokenRefused: true }));
    await apps.save({ ...BOT, bot: { token: 'xoxb-1', userId: 'U01' } });

    await expect(readSlack(READER)).resolves.toMatchObject({ workspace: { teamId: 'T0ACME', name: 'Acme' }, tokenState: 'refused', gatewayBot: 'installed', canChange: false });
  });

  it("shows the gateway's bot not made while Slack has not made it", async () => {
    await workspaces.save(aSlackWorkspace());

    await expect(readSlack(HOLDER)).resolves.toMatchObject({ gatewayBot: 'notMade' });
  });
});
