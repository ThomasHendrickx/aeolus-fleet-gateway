import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aSlackWorkspace, fakeSlackTooling, memorySlackApps, memorySlackWorkspaces } from '../../../test/support/slack-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import { createDisconnectSlack } from './disconnect-slack.js';
import { createTakeAccessToken } from './take-access-token.js';

// Disconnect removes every bot the gateway made (apps.manifest.delete), then
// forgets the workspace (gateway scopes 9.1). Removing a bot needs a working
// configuration token: after Slack refused it, connect again first.

const NOW = new Date('2026-10-27T09:00:00.000Z');
const HOLDER: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc-charlotte', personShipId: 'shp_01m3tbfspe96yf1rnr4ank9c4r', accountToken: 'account-token-1', scopes: ['gateway:slack'] };
const BOT = { fleetId: FLEET_ID, appId: 'A01', shipId: null, clientId: 'c', clientSecret: 's', signingSecret: 'g', installUrl: 'https://slack.com/i', madeAt: NOW, bot: { token: 'xoxb-1', userId: 'U01' } };

let tooling: ReturnType<typeof fakeSlackTooling>;
let workspaces: ReturnType<typeof memorySlackWorkspaces>;
let apps: ReturnType<typeof memorySlackApps>;

beforeEach(() => {
  tooling = fakeSlackTooling({ now: () => NOW });
  workspaces = memorySlackWorkspaces();
  apps = memorySlackApps();
});

function disconnectSlack(actor: Actor = HOLDER) {
  const clock = { now: () => NOW };
  return createDisconnectSlack({ slack: tooling.slack, workspaces, apps, takeAccessToken: createTakeAccessToken({ slack: tooling.slack, workspaces, clock }) })({ actor });
}

describe('disconnecting Slack', () => {
  it('removes every bot the gateway made in Slack, then forgets the workspace', async () => {
    await workspaces.save(aSlackWorkspace());
    await apps.save(BOT);

    await expect(disconnectSlack()).resolves.toEqual({ isOk: true, value: undefined });
    expect({ removed: tooling.state.removed, isConnected: workspaces.held.has(FLEET_ID) }).toEqual({ removed: [{ accessToken: 'xoxe.xoxp-kept', appId: 'A01' }], isConnected: false });
  });

  it('forgets a bot Slack no longer knows, as one removed there', async () => {
    await workspaces.save(aSlackWorkspace());
    await apps.save(BOT);
    tooling.state.refusal = { kind: 'refused', error: 'app_not_found' };

    await expect(disconnectSlack()).resolves.toEqual({ isOk: true, value: undefined });
    expect(workspaces.held.has(FLEET_ID)).toBe(false);
  });

  it('keeps everything when Slack does not answer, to disconnect again', async () => {
    await workspaces.save(aSlackWorkspace());
    await apps.save(BOT);
    tooling.state.refusal = { kind: 'unavailable', message: 'connect ECONNREFUSED' };

    await expect(disconnectSlack()).resolves.toMatchObject({ isOk: false, error: { kind: 'SLACK_UNAVAILABLE' } });
    expect(workspaces.held.has(FLEET_ID)).toBe(true);
  });

  it('is refused after Slack refused the configuration token, removing nothing', async () => {
    await workspaces.save(aSlackWorkspace({ isTokenRefused: true }));
    await apps.save(BOT);

    await expect(disconnectSlack()).resolves.toMatchObject({ isOk: false, error: { kind: 'SLACK_TOKEN_REFUSED' } });
    expect({ removed: tooling.state.removed, isConnected: workspaces.held.has(FLEET_ID) }).toEqual({ removed: [], isConnected: true });
  });

  it('is refused to an actor without gateway:slack', async () => {
    await workspaces.save(aSlackWorkspace());

    await expect(disconnectSlack({ ...HOLDER, scopes: ['fleet:manage'] })).resolves.toMatchObject({ isOk: false, error: { kind: 'SLACK_SCOPE_NOT_HELD' } });
    expect(workspaces.held.has(FLEET_ID)).toBe(true);
  });
});
