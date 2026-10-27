import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aSlackApp, aSlackWorkspace, fakeSlackShips, fakeSlackTooling, memorySlackApps, memorySlackWorkspaces, SLACK_ADDRESSES } from '../../../test/support/slack-fakes.js';
import { createFollowExposedShips } from './follow-exposed-ships.js';
import { createTakeAccessToken } from './take-access-token.js';

// The bot is tied to the ship by its id (L20): a rename updates the bot's
// name in Slack the next time the gateway reads the ship, and a retired
// ship's bot is deleted (gateway scopes 9.2).

const NOW = new Date('2026-10-27T09:00:00.000Z');
const ADDRESSES = SLACK_ADDRESSES;
const RELEASE_NOTES = 'shp_01m3tbfspe96yf1rnr4ank9r1n';
const OLD_WRITER = 'shp_01m3tbfspe96yf1rnr4ank9o1d';
const QUOTES = 'shp_01m3tbfspe96yf1rnr4ank9q0t';

let tooling: ReturnType<typeof fakeSlackTooling>;
let workspaces: ReturnType<typeof memorySlackWorkspaces>;
let apps: ReturnType<typeof memorySlackApps>;
let ships: ReturnType<typeof fakeSlackShips>;

beforeEach(async () => {
  tooling = fakeSlackTooling({ now: () => NOW });
  workspaces = memorySlackWorkspaces();
  apps = memorySlackApps();
  ships = fakeSlackShips([
    { shipId: RELEASE_NOTES, name: 'changelog', kind: 'agent', status: 'crewed', summary: 'Writes the release notes' },
    { shipId: OLD_WRITER, name: 'old-writer', kind: 'agent', status: 'retired', summary: null },
    { shipId: QUOTES, name: 'quotes', kind: 'app', status: 'crewed', summary: null },
  ]);
  await workspaces.save(aSlackWorkspace());
  await apps.save(aSlackApp({ appId: 'A01' }));
  await apps.save(aSlackApp({ appId: 'A02', shipId: RELEASE_NOTES, name: 'release-notes' }));
  await apps.save(aSlackApp({ appId: 'A03', shipId: OLD_WRITER, name: 'old-writer' }));
  await apps.save(aSlackApp({ appId: 'A04', shipId: QUOTES, name: 'quotes' }));
});

function follow() {
  const clock = { now: () => NOW };
  return createFollowExposedShips({ workspaces, apps, ships: ships.port, slack: tooling.slack, takeAccessToken: createTakeAccessToken({ slack: tooling.slack, workspaces, clock }), addresses: ADDRESSES })();
}

describe('following the exposed ships', () => {
  it("renames a renamed ship's bot in Slack with its whole manifest, and keeps the new name", async () => {
    await follow();

    expect(tooling.state.renamed.map(({ appId, description }) => ({ appId, name: description.name, description: description.description }))).toEqual([{ appId: 'A02', name: 'changelog', description: 'Writes the release notes' }]);
    expect(apps.held.find(({ appId }) => appId === 'A02')?.name).toBe('changelog');
  });

  it("deletes a retired ship's bot in Slack and forgets it, leaving the others and the gateway's bot", async () => {
    await follow();

    expect({ removed: tooling.state.removed.map(({ appId }) => appId), kept: apps.held.map(({ appId }) => appId) }).toEqual({ removed: ['A03'], kept: ['A01', 'A02', 'A04'] });
  });

  it('changes nothing while the fleet does not answer', async () => {
    ships.state.isAnswering = false;

    await follow();

    expect({ renamed: tooling.state.renamed, removed: tooling.state.removed, kept: apps.held.length }).toEqual({ renamed: [], removed: [], kept: 4 });
  });

  it('keeps the old name, to rename again, when Slack does not answer', async () => {
    tooling.state.refusal = { kind: 'unavailable', message: 'connect ECONNREFUSED' };

    await follow();

    expect(apps.held.find(({ appId }) => appId === 'A02')?.name).toBe('release-notes');
  });

  it('leaves a fleet whose configuration token Slack refused', async () => {
    await workspaces.save(aSlackWorkspace({ fleetId: FLEET_ID, isTokenRefused: true }));

    await follow();

    expect({ renamed: tooling.state.renamed, removed: tooling.state.removed }).toEqual({ renamed: [], removed: [] });
  });
});
