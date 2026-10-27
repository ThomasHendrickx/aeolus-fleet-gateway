import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aSlackWorkspace, fakeShipNames, fakeSlackTooling, memorySlackApps, memorySlackWorkspaces } from '../../../test/support/slack-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import { createConnectSlack } from './connect-slack.js';

// An actor holding gateway:slack connects the fleet to one workspace by
// pasting an app configuration refresh token (gateway scopes 9.1). With it
// the gateway makes its own bot first, named after the fleet (B5). A token
// Slack refuses makes nothing.

const NOW = new Date('2026-10-27T09:00:00.000Z');
const REDIRECT_URL = 'https://gateway.acme.test/gw/slack/install';
const CHARLOTTE_SHIP = 'shp_01m3tbfspe96yf1rnr4ank9c4r';
const CHARLOTTE: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc-charlotte', personShipId: CHARLOTTE_SHIP, accountToken: 'account-token-1', scopes: ['fleet:read', 'gateway:slack'] };

let tooling: ReturnType<typeof fakeSlackTooling>;
let workspaces: ReturnType<typeof memorySlackWorkspaces>;
let apps: ReturnType<typeof memorySlackApps>;

beforeEach(() => {
  tooling = fakeSlackTooling({ now: () => NOW });
  workspaces = memorySlackWorkspaces();
  apps = memorySlackApps();
});

function connectSlack(input: { actor?: Actor; refreshToken?: string }) {
  return createConnectSlack({ slack: tooling.slack, workspaces, apps, shipNames: fakeShipNames(), clock: { now: () => NOW }, installRedirectUrl: REDIRECT_URL })({
    actor: input.actor ?? CHARLOTTE,
    refreshToken: input.refreshToken ?? 'xoxe-1-first',
    fleetName: 'Acme',
  });
}

describe('connecting a Slack workspace', () => {
  it('keeps the rotated configuration token, the workspace and who connected it', async () => {
    await expect(connectSlack({})).resolves.toEqual({ isOk: true, value: { isGatewayBotMade: true } });
    expect(workspaces.held.get(FLEET_ID)).toEqual({
      fleetId: FLEET_ID,
      teamId: 'T0ACME',
      teamName: null,
      connectedBy: { shipId: CHARLOTTE_SHIP, name: 'charlotte' },
      connectedAt: NOW,
      token: { accessToken: 'xoxe.xoxp-1', refreshToken: 'xoxe-1-1', expiresAt: new Date('2026-10-27T21:00:00.000Z') },
      isTokenRefused: false,
    });
  });

  it("makes the gateway's bot, named after the fleet, with the bot scopes to write to a person directly", async () => {
    await connectSlack({});

    expect(tooling.state.made).toEqual([
      {
        accessToken: 'xoxe.xoxp-1',
        appId: 'A01',
        description: { name: 'Acme', description: 'What waits for you in the Acme fleet of Aeolus', botScopes: ['chat:write', 'im:history', 'im:write'], redirectUrl: REDIRECT_URL },
      },
    ]);
    expect(apps.held).toEqual([
      { fleetId: FLEET_ID, appId: 'A01', shipId: null, clientId: 'client-A01', clientSecret: 'secret-A01', signingSecret: 'signing-A01', installUrl: 'https://slack.com/oauth/v2/authorize?client_id=client-A01', madeAt: NOW, bot: null },
    ]);
  });

  it("stays connected when Slack does not make the gateway's bot yet, so Install makes it", async () => {
    tooling.state.makeRefusal = { kind: 'rateLimited', retryAfterSeconds: 60 };

    await expect(connectSlack({})).resolves.toEqual({ isOk: true, value: { isGatewayBotMade: false } });
    expect({ isConnected: workspaces.held.has(FLEET_ID), apps: apps.held }).toEqual({ isConnected: true, apps: [] });
  });

  it('is refused, making nothing, when Slack refuses the configuration token', async () => {
    await expect(connectSlack({ refreshToken: 'xoxe-1-expired' })).resolves.toEqual({
      isOk: false,
      error: { kind: 'SLACK_TOKEN_REFUSED', message: 'Slack refused the configuration token (invalid_refresh_token): copy a new one from your Slack app management page' },
    });
    expect({ workspaces: workspaces.held.size, made: tooling.state.made }).toEqual({ workspaces: 0, made: [] });
  });

  it('is refused to an actor without gateway:slack', async () => {
    await expect(connectSlack({ actor: { ...CHARLOTTE, scopes: ['fleet:read', 'gateway:approve'] } })).resolves.toEqual({ isOk: false, error: { kind: 'SLACK_SCOPE_NOT_HELD', message: 'Connecting Slack needs gateway:slack' } });
    expect(tooling.state.rotations).toBe(0);
  });

  it('is refused to a ship: a configuration token is a person\'s, pasted signed in with their account', async () => {
    const ship: Actor = { fleetId: FLEET_ID, kind: 'ship', shipId: 'shp_01m3tbfspe96yf1rnr4ank9nwk', scopes: ['gateway:slack'] };

    await expect(connectSlack({ actor: ship })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_AN_ACCOUNT' } });
  });

  it('is refused while the fleet is connected with a working configuration token', async () => {
    await workspaces.save(aSlackWorkspace());

    await expect(connectSlack({})).resolves.toMatchObject({ isOk: false, error: { kind: 'ALREADY_CONNECTED' } });
    expect(tooling.state.rotations).toBe(0);
  });

  it('connects again with a new configuration token of the same workspace after Slack refused the old one, keeping its apps', async () => {
    await workspaces.save(aSlackWorkspace({ teamName: 'Acme', isTokenRefused: true }));
    await apps.save({ fleetId: FLEET_ID, appId: 'A07', shipId: null, clientId: 'c', clientSecret: 's', signingSecret: 'g', installUrl: 'https://slack.com/i', madeAt: NOW, bot: { token: 'xoxb-7', userId: 'U07' } });

    await expect(connectSlack({})).resolves.toEqual({ isOk: true, value: { isGatewayBotMade: true } });
    expect({ workspace: workspaces.held.get(FLEET_ID), made: tooling.state.made.length }).toEqual({
      workspace: expect.objectContaining({ teamName: 'Acme', isTokenRefused: false, token: expect.objectContaining({ refreshToken: 'xoxe-1-1' }) }),
      made: 0,
    });
  });

  it('is refused connecting again with a configuration token of another workspace', async () => {
    await workspaces.save(aSlackWorkspace({ teamId: 'T0OTHER', teamName: 'Globex', isTokenRefused: true }));

    await expect(connectSlack({})).resolves.toEqual({
      isOk: false,
      error: { kind: 'OTHER_WORKSPACE', message: 'The fleet is connected to Globex: connect with a configuration token of that workspace' },
    });
    expect(workspaces.held.get(FLEET_ID)).toMatchObject({ teamId: 'T0OTHER', isTokenRefused: true });
  });
});
