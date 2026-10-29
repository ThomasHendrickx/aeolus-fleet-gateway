import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aSlackWorkspace, fakeSlackTooling, memorySlackWorkspaces } from '../../../test/support/slack-fakes.js';
import { createTakeAccessToken } from './take-access-token.js';

// Slack's configuration access token lives 12 hours, and its refresh token
// is good once (gateway scopes 9.1). The gateway uses the access token while
// it is fresh, and rotates it, one rotation at a time, when it is not.

const NOW = new Date('2026-10-27T09:00:00.000Z');
const IN_THREE_HOURS = new Date('2026-10-27T12:00:00.000Z');
const IN_HALF_AN_HOUR = new Date('2026-10-27T09:30:00.000Z');

let tooling: ReturnType<typeof fakeSlackTooling>;
let workspaces: ReturnType<typeof memorySlackWorkspaces>;

beforeEach(() => {
  tooling = fakeSlackTooling({ now: () => NOW });
  workspaces = memorySlackWorkspaces();
});

function takeAccessToken() {
  return createTakeAccessToken({ slack: tooling.slack, workspaces, clock: { now: () => NOW } })(FLEET_ID);
}

describe("a fleet's configuration access token", () => {
  it('is used as kept while it works for more than an hour', async () => {
    await workspaces.save(aSlackWorkspace({ token: { accessToken: 'xoxe.xoxp-kept', refreshToken: 'xoxe-1-first', expiresAt: IN_THREE_HOURS } }));

    await expect(takeAccessToken()).resolves.toEqual({ isOk: true, value: 'xoxe.xoxp-kept' });
    expect(tooling.state.rotations).toBe(0);
  });

  it('is rotated within its last hour, and the new pair kept', async () => {
    await workspaces.save(aSlackWorkspace({ token: { accessToken: 'xoxe.xoxp-kept', refreshToken: 'xoxe-1-first', expiresAt: IN_HALF_AN_HOUR } }));

    await expect(takeAccessToken()).resolves.toEqual({ isOk: true, value: 'xoxe.xoxp-1' });
    expect(workspaces.held.get(FLEET_ID)?.token).toEqual({ accessToken: 'xoxe.xoxp-1', refreshToken: 'xoxe-1-1', expiresAt: new Date('2026-10-27T21:00:00.000Z') });
  });

  it('is marked refused when Slack refuses the refresh token, and stays refused', async () => {
    await workspaces.save(aSlackWorkspace({ token: { accessToken: 'xoxe.xoxp-kept', refreshToken: 'xoxe-1-revoked', expiresAt: IN_HALF_AN_HOUR } }));

    await expect(takeAccessToken()).resolves.toEqual({
      isOk: false,
      error: { kind: 'SLACK_TOKEN_REFUSED', message: 'Slack refused the configuration token. Connect again to make or change bots; bots already installed keep working' },
    });
    await expect(takeAccessToken()).resolves.toMatchObject({ isOk: false, error: { kind: 'SLACK_TOKEN_REFUSED' } });
    expect({ isRefused: workspaces.held.get(FLEET_ID)?.isTokenRefused, rotations: tooling.state.rotations }).toEqual({ isRefused: true, rotations: 0 });
  });

  it('keeps the old pair when Slack does not answer, to rotate again later', async () => {
    const token = { accessToken: 'xoxe.xoxp-kept', refreshToken: 'xoxe-1-first', expiresAt: IN_HALF_AN_HOUR };
    await workspaces.save(aSlackWorkspace({ token }));
    tooling.state.refusal = { kind: 'unavailable', message: 'connect ECONNREFUSED' };

    await expect(takeAccessToken()).resolves.toEqual({ isOk: false, error: { kind: 'SLACK_UNAVAILABLE', message: 'Slack did not answer: try again' } });
    expect(workspaces.held.get(FLEET_ID)).toMatchObject({ token, isTokenRefused: false });
  });

  it('is none for a fleet connected to no workspace', async () => {
    await expect(takeAccessToken()).resolves.toMatchObject({ isOk: false, error: { kind: 'SLACK_NOT_CONNECTED' } });
  });
});
