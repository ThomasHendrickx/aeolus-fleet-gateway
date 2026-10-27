import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aSlackWorkspace, fakeSlackTooling, memorySlackApps, memorySlackWorkspaces, plainInstallStates } from '../../../test/support/slack-fakes.js';
import { createCompleteInstall } from './complete-install.js';

// Slack's install screen sends the person back to the gateway with a code
// and the state it was opened with. The gateway turns the code into the
// app's bot token, keeps it in its vault, and learns the workspace's name.

const NOW = new Date('2026-10-27T09:05:00.000Z');
const REDIRECT_URL = 'https://gateway.acme.test/gw/slack/install';
const MADE_BOT = { fleetId: FLEET_ID, appId: 'A01', shipId: null, clientId: 'client-A01', clientSecret: 'secret-A01', signingSecret: 'signing-A01', installUrl: 'https://slack.com/oauth/v2/authorize?client_id=client-A01', name: 'Acme', madeAt: NOW, installStartedAt: null, removedInSlackAt: null, bot: null };
const STATE = JSON.stringify({ fleetId: FLEET_ID, appId: 'A01', expiresAt: '2026-10-27T09:10:00.000Z' });

let tooling: ReturnType<typeof fakeSlackTooling>;
let workspaces: ReturnType<typeof memorySlackWorkspaces>;
let apps: ReturnType<typeof memorySlackApps>;

beforeEach(async () => {
  tooling = fakeSlackTooling();
  workspaces = memorySlackWorkspaces();
  apps = memorySlackApps();
  await workspaces.save(aSlackWorkspace());
  await apps.save(MADE_BOT);
  tooling.state.codes.set('code-1', 'A01');
});

function completeInstall(input: { code?: string; state?: string; now?: Date }) {
  return createCompleteInstall({ slack: tooling.slack, apps, workspaces, states: plainInstallStates(), clock: { now: () => input.now ?? NOW }, installRedirectUrl: REDIRECT_URL })({
    code: input.code ?? 'code-1',
    state: input.state ?? STATE,
  });
}

describe("completing a Slack app's install", () => {
  it("keeps the bot token Slack gave for the code, and the workspace's name", async () => {
    await expect(completeInstall({})).resolves.toEqual({ isOk: true, value: { fleetId: FLEET_ID } });
    expect({ bot: apps.held[0]?.bot, teamName: workspaces.held.get(FLEET_ID)?.teamName, installs: tooling.state.installs }).toEqual({
      bot: { token: 'xoxb-A01', userId: 'U0A01' },
      teamName: 'Acme',
      installs: [{ clientId: 'client-A01', code: 'code-1', redirectUrl: REDIRECT_URL }],
    });
  });

  it('is refused for a state the gateway did not seal, asking Slack nothing', async () => {
    await expect(completeInstall({ state: 'forged' })).resolves.toEqual({ isOk: false, error: { kind: 'INSTALL_REFUSED', message: 'This install did not start at the gateway, or took longer than ten minutes: press Install again' } });
    expect(tooling.state.installs).toEqual([]);
  });

  it('is refused once its ten minutes passed', async () => {
    await expect(completeInstall({ now: new Date('2026-10-27T09:10:00.001Z') })).resolves.toMatchObject({ isOk: false, error: { kind: 'INSTALL_REFUSED' } });
  });

  it('is refused when Slack refuses the code, keeping no bot', async () => {
    await expect(completeInstall({ code: 'code-used' })).resolves.toEqual({ isOk: false, error: { kind: 'INSTALL_REFUSED', message: 'Slack refused the install (invalid_code): press Install again' } });
    expect(apps.held[0]?.bot).toBeNull();
  });

  it('is refused for an install into another workspace than the fleet connected', async () => {
    await workspaces.save(aSlackWorkspace({ teamId: 'T0OTHER' }));

    await expect(completeInstall({})).resolves.toMatchObject({ isOk: false, error: { kind: 'OTHER_WORKSPACE' } });
    expect(apps.held[0]?.bot).toBeNull();
  });
});
