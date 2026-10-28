import type { FleetId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { aSlackWorkspace, fakeSlackTooling, memorySlackWorkspaces } from '../../../test/support/slack-fakes.js';
import { createRotateConfigurationTokens } from './rotate-configuration-tokens.js';
import { createTakeAccessToken } from './take-access-token.js';

// The gateway keeps each fleet's configuration token alive by rotating it
// before its 12 hours end (gateway scopes 9.1), so a bot can be made or
// removed whenever someone asks; a refused token is left for Connect again.

const NOW = new Date('2026-10-27T09:00:00.000Z');
const ACME: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const LABS: FleetId = 'flt_01m4ajt7abh4rypkmdnjene67g';
const GLOBEX: FleetId = 'flt_01m4ajt7abh4rypkmdnjene6zz';

describe('rotating configuration tokens', () => {
  it('rotates each token within its last hour, leaves fresh ones, and skips refused ones', async () => {
    const tooling = fakeSlackTooling({ now: () => NOW });
    tooling.state.refreshTokens.add('xoxe-1-labs');
    const workspaces = memorySlackWorkspaces();
    await workspaces.save(aSlackWorkspace({ fleetId: ACME, token: { accessToken: 'xoxe.xoxp-acme', refreshToken: 'xoxe-1-first', expiresAt: new Date('2026-10-27T09:45:00.000Z') } }));
    await workspaces.save(aSlackWorkspace({ fleetId: LABS, token: { accessToken: 'xoxe.xoxp-labs', refreshToken: 'xoxe-1-labs', expiresAt: new Date('2026-10-27T18:00:00.000Z') } }));
    await workspaces.save(aSlackWorkspace({ fleetId: GLOBEX, isTokenRefused: true, token: { accessToken: 'xoxe.xoxp-globex', refreshToken: 'xoxe-1-globex', expiresAt: new Date('2026-10-27T09:10:00.000Z') } }));
    const clock = { now: () => NOW };

    await createRotateConfigurationTokens({ workspaces, takeAccessToken: createTakeAccessToken({ slack: tooling.slack, workspaces, clock }) })();

    expect([ACME, LABS, GLOBEX].map((fleetId) => workspaces.held.get(fleetId)?.token.accessToken)).toEqual(['xoxe.xoxp-1', 'xoxe.xoxp-labs', 'xoxe.xoxp-globex']);
  });
});
