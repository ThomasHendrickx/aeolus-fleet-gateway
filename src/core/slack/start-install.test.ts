import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aSlackWorkspace, fakeSlackTooling, memorySlackApps, memorySlackWorkspaces, plainInstallStates } from '../../../test/support/slack-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import { createStartInstall } from './start-install.js';
import { createTakeAccessToken } from './take-access-token.js';

// Install opens Slack's install screen for the gateway's bot, installed by
// the person who connected or anyone holding gateway:slack (gateway scopes
// 9.1). The address carries a sealed state, so the gateway takes back only
// an install it started, within ten minutes.

const NOW = new Date('2026-10-27T09:00:00.000Z');
const REDIRECT_URL = 'https://gateway.acme.test/gw/slack/install';
const CHARLOTTE: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc-charlotte', personShipId: 'shp_01m3tbfspe96yf1rnr4ank9c4r', accountToken: 'account-token-1', scopes: ['gateway:slack'] };
const MADE_BOT = { fleetId: FLEET_ID, appId: 'A01', shipId: null, clientId: 'client-A01', clientSecret: 'secret-A01', signingSecret: 'signing-A01', installUrl: 'https://slack.com/oauth/v2/authorize?client_id=client-A01&scope=chat%3Awrite', name: 'Acme', madeAt: NOW, installStartedAt: null, removedInSlackAt: null, bot: null };

let tooling: ReturnType<typeof fakeSlackTooling>;
let workspaces: ReturnType<typeof memorySlackWorkspaces>;
let apps: ReturnType<typeof memorySlackApps>;

beforeEach(() => {
  tooling = fakeSlackTooling({ now: () => NOW });
  workspaces = memorySlackWorkspaces();
  apps = memorySlackApps();
});

function startInstall(actor: Actor = CHARLOTTE) {
  const clock = { now: () => NOW };
  return createStartInstall({
    slack: tooling.slack,
    apps,
    workspaces,
    takeAccessToken: createTakeAccessToken({ slack: tooling.slack, workspaces, clock }),
    states: plainInstallStates(),
    clock,
    installRedirectUrl: REDIRECT_URL,
  })({ actor, fleetName: 'Acme' });
}

describe("installing the gateway's bot", () => {
  it("opens Slack's install screen for the bot, with a state sealed for ten minutes", async () => {
    await workspaces.save(aSlackWorkspace());
    await apps.save(MADE_BOT);

    const started = await startInstall();

    expect(started.isOk && new URL(started.value.url).searchParams.get('state')).toBe(JSON.stringify({ fleetId: FLEET_ID, appId: 'A01', expiresAt: new Date('2026-10-27T09:10:00.000Z') }));
    expect(started.isOk && started.value.url.startsWith('https://slack.com/oauth/v2/authorize?client_id=client-A01&scope=chat%3Awrite&state=')).toBe(true);
  });

  it("makes the gateway's bot first when Slack did not make it at connect", async () => {
    await workspaces.save(aSlackWorkspace());

    await expect(startInstall()).resolves.toMatchObject({ isOk: true });
    expect(apps.held.map(({ appId, shipId }) => ({ appId, shipId }))).toEqual([{ appId: 'A01', shipId: null }]);
  });

  it("says when Slack asks to wait before it makes the gateway's bot", async () => {
    await workspaces.save(aSlackWorkspace());
    tooling.state.makeRefusal = { kind: 'rateLimited', retryAfterSeconds: 42 };

    await expect(startInstall()).resolves.toEqual({ isOk: false, error: { kind: 'SLACK_UNAVAILABLE', message: 'Slack asks to wait 42 seconds: try again then' } });
  });

  it("is refused to make the gateway's bot once Slack refused the configuration token", async () => {
    await workspaces.save(aSlackWorkspace({ isTokenRefused: true }));

    await expect(startInstall()).resolves.toMatchObject({ isOk: false, error: { kind: 'SLACK_TOKEN_REFUSED' } });
  });

  it('is refused to an actor without gateway:slack', async () => {
    await workspaces.save(aSlackWorkspace());
    await apps.save(MADE_BOT);

    await expect(startInstall({ ...CHARLOTTE, scopes: ['gateway:approve'] })).resolves.toMatchObject({ isOk: false, error: { kind: 'SLACK_SCOPE_NOT_HELD' } });
  });

  it('is refused while the fleet is connected to no workspace', async () => {
    await expect(startInstall()).resolves.toMatchObject({ isOk: false, error: { kind: 'SLACK_NOT_CONNECTED' } });
  });
});
