import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aSlackApp, aSlackWorkspace, fakeProxyShipKinds, fakeSlackShips, fakeSlackTooling, memorySlackApps, memorySlackWorkspaces, SLACK_ADDRESSES } from '../../../test/support/slack-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import { ok } from '../shared/result.js';
import { createExposeShip } from './expose-ship.js';
import { createTakeAccessToken } from './take-access-token.js';

// An actor holding gateway:slack, within manage reach of the ship (B6),
// exposes an agent ship or an outside A2A agent's proxy ship as a Slack bot
// (gateway scopes 9.2, P-B3): the gateway makes its app from a manifest,
// named after the ship, its statement's summary as the description. An
// outside MCP server's proxy ship takes tool calls, not words: never.

const NOW = new Date('2026-10-27T09:00:00.000Z');
const ADDRESSES = SLACK_ADDRESSES;
const ANA: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc-ana', personShipId: 'shp_01m3tbfspe96yf1rnr4ank9a7a', accountToken: 'account-token-ana', scopes: ['gateway:slack'] };
const AS = { cookie: 'aeolus_account_session=ana' };
const RELEASE_NOTES = { shipId: 'shp_01m3tbfspe96yf1rnr4ank9r1n', name: 'release-notes', kind: 'agent', status: 'crewed', summary: 'Writes the release notes of each version' } as const;
const QUOTES = { shipId: 'shp_01m3tbfspe96yf1rnr4ank9q0t', name: 'quotes', kind: 'app', status: 'crewed', summary: 'Quotes from the pricing agent' } as const;
const CRM = { shipId: 'shp_01m3tbfspe96yf1rnr4ank9c0m', name: 'crm', kind: 'app', status: 'crewed', summary: 'The CRM' } as const;
const CHARLOTTE = { shipId: 'shp_01m3tbfspe96yf1rnr4ank9c4r', name: 'charlotte', kind: 'person', status: 'crewed', summary: null } as const;

let tooling: ReturnType<typeof fakeSlackTooling>;
let workspaces: ReturnType<typeof memorySlackWorkspaces>;
let apps: ReturnType<typeof memorySlackApps>;
let ships: ReturnType<typeof fakeSlackShips>;

beforeEach(async () => {
  tooling = fakeSlackTooling({ now: () => NOW });
  workspaces = memorySlackWorkspaces();
  apps = memorySlackApps();
  ships = fakeSlackShips([RELEASE_NOTES, QUOTES, CRM, CHARLOTTE]);
  await workspaces.save(aSlackWorkspace());
});

function exposeShip(shipId: ShipId, actor: Actor = ANA) {
  const clock = { now: () => NOW };
  return createExposeShip({
    slack: tooling.slack,
    apps,
    ships: ships.port,
    proxyShips: fakeProxyShipKinds({ [QUOTES.shipId]: 'a2aAgent', [CRM.shipId]: 'mcpServer' }),
    takeAccessToken: createTakeAccessToken({ slack: tooling.slack, workspaces, clock }),
    credentialOf: (_actor, sent) => Promise.resolve(ok(sent)),
    clock,
    addresses: ADDRESSES,
  })({ actor, as: AS, shipId });
}

describe('exposing a ship as a Slack bot', () => {
  it("makes the agent ship's app, named after it, its summary as the description, kept by the ship's id", async () => {
    await expect(exposeShip(RELEASE_NOTES.shipId)).resolves.toEqual({ isOk: true, value: { appId: 'A01' } });
    expect(tooling.state.made.map(({ description }) => description)).toEqual([
      {
        name: 'release-notes',
        description: 'Writes the release notes of each version',
        botScopes: ['chat:write', 'im:history', 'app_mentions:read', 'reactions:write'],
        userScopes: [],
        redirectUrls: [ADDRESSES.installRedirectUrl],
        events: { url: ADDRESSES.eventsUrl, botEvents: ['message.im', 'app_mention', 'app_uninstalled', 'tokens_revoked'] },
        actionsUrl: ADDRESSES.actionsUrl,
      },
    ]);
    expect(apps.held).toEqual([aSlackApp({ appId: 'A01', shipId: RELEASE_NOTES.shipId, name: 'release-notes', madeAt: NOW, installUrl: 'https://slack.com/oauth/v2/authorize?client_id=client-A01' })]);
  });

  it("exposes an outside A2A agent's proxy ship", async () => {
    await expect(exposeShip(QUOTES.shipId)).resolves.toMatchObject({ isOk: true });
  });

  it("refuses an outside MCP server's proxy ship, making nothing", async () => {
    await expect(exposeShip(CRM.shipId)).resolves.toEqual({
      isOk: false,
      error: { kind: 'NOT_EXPOSABLE', message: "crm is an outside MCP server's proxy ship: it takes tool calls, not a person's words. Expose an agent ship that uses its tools" },
    });
    expect(tooling.state.made).toEqual([]);
  });

  it('refuses a person ship', async () => {
    await expect(exposeShip(CHARLOTTE.shipId)).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_EXPOSABLE', message: 'charlotte is no agent ship nor an outside A2A agent\'s proxy ship' } });
  });

  it("refuses a ship outside the actor's manage reach, by its name", async () => {
    ships.state.managed.delete(RELEASE_NOTES.shipId);

    await expect(exposeShip(RELEASE_NOTES.shipId)).resolves.toEqual({ isOk: false, error: { kind: 'NOT_REACHABLE', message: 'You do not manage release-notes' } });
    expect(tooling.state.made).toEqual([]);
  });

  it('refuses a ship exposed already', async () => {
    await apps.save(aSlackApp({ appId: 'A07', shipId: RELEASE_NOTES.shipId }));

    await expect(exposeShip(RELEASE_NOTES.shipId)).resolves.toMatchObject({ isOk: false, error: { kind: 'CONFLICT', message: 'release-notes is a Slack bot already' } });
  });

  it('refuses a retired ship', async () => {
    ships.state.ships = [{ ...RELEASE_NOTES, status: 'retired' }];

    await expect(exposeShip(RELEASE_NOTES.shipId)).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_EXPOSABLE', message: 'release-notes was retired' } });
  });

  it('says when Slack asks to wait before it makes another app, keeping nothing', async () => {
    tooling.state.makeRefusal = { kind: 'rateLimited', retryAfterSeconds: 50 };

    await expect(exposeShip(RELEASE_NOTES.shipId)).resolves.toEqual({ isOk: false, error: { kind: 'SLACK_UNAVAILABLE', message: 'Slack asks to wait 50 seconds: try again then' } });
    expect(apps.held).toEqual([]);
  });

  it('refuses while Slack refused the configuration token', async () => {
    await workspaces.save(aSlackWorkspace({ isTokenRefused: true }));

    await expect(exposeShip(RELEASE_NOTES.shipId)).resolves.toMatchObject({ isOk: false, error: { kind: 'SLACK_TOKEN_REFUSED' } });
  });

  it('refuses an actor without gateway:slack', async () => {
    await expect(exposeShip(RELEASE_NOTES.shipId, { ...ANA, scopes: ['fleet:manage'] })).resolves.toMatchObject({ isOk: false, error: { kind: 'SLACK_SCOPE_NOT_HELD' } });
  });
});
