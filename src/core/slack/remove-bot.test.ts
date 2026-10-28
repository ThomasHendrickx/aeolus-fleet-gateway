import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aSlackApp, aSlackWorkspace, fakeSlackShips, fakeSlackTooling, memorySlackApps, memorySlackWorkspaces } from '../../../test/support/slack-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import { ok } from '../shared/result.js';
import { createRemoveBot } from './remove-bot.js';
import { createTakeAccessToken } from './take-access-token.js';

// Remove deletes a ship's bot from Slack after a confirm (gateway scopes
// 9.2), by an actor holding gateway:slack within manage reach of the ship.

const NOW = new Date('2026-10-27T09:00:00.000Z');
const ANA: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc-ana', personShipId: 'shp_01m3tbfspe96yf1rnr4ank9a7a', accountToken: 'account-token-ana', scopes: ['gateway:slack'] };
const RELEASE_NOTES = { shipId: 'shp_01m3tbfspe96yf1rnr4ank9r1n', name: 'release-notes', kind: 'agent', status: 'crewed', summary: null } as const;

let tooling: ReturnType<typeof fakeSlackTooling>;
let workspaces: ReturnType<typeof memorySlackWorkspaces>;
let apps: ReturnType<typeof memorySlackApps>;
let ships: ReturnType<typeof fakeSlackShips>;

beforeEach(async () => {
  tooling = fakeSlackTooling({ now: () => NOW });
  workspaces = memorySlackWorkspaces();
  apps = memorySlackApps();
  ships = fakeSlackShips([RELEASE_NOTES]);
  await workspaces.save(aSlackWorkspace());
  await apps.save(aSlackApp({ appId: 'A02', shipId: RELEASE_NOTES.shipId, name: 'release-notes', bot: { token: 'xoxb-2', userId: 'U02' } }));
});

function removeBot(appId: string, actor: Actor = ANA) {
  const clock = { now: () => NOW };
  return createRemoveBot({ slack: tooling.slack, apps, ships: ships.port, takeAccessToken: createTakeAccessToken({ slack: tooling.slack, workspaces, clock }), credentialOf: (_actor, sent) => Promise.resolve(ok(sent)) })({ actor, as: {}, appId });
}

describe("removing a ship's bot", () => {
  it('deletes its app in Slack and forgets it', async () => {
    await expect(removeBot('A02')).resolves.toEqual({ isOk: true, value: undefined });
    expect({ removed: tooling.state.removed.map(({ appId }) => appId), apps: apps.held }).toEqual({ removed: ['A02'], apps: [] });
  });

  it("is refused outside the actor's manage reach, keeping the bot", async () => {
    ships.state.managed.clear();

    await expect(removeBot('A02')).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_REACHABLE', message: 'You do not manage release-notes' } });
    expect(apps.held).toHaveLength(1);
  });

  it("is refused for the gateway's own bot, which goes only with Disconnect", async () => {
    await apps.save(aSlackApp({ appId: 'A01' }));

    await expect(removeBot('A01')).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_BOT' } });
  });

  it('keeps the bot when Slack does not answer', async () => {
    tooling.state.refusal = { kind: 'unavailable', message: 'connect ECONNREFUSED' };

    await expect(removeBot('A02')).resolves.toMatchObject({ isOk: false, error: { kind: 'SLACK_UNAVAILABLE' } });
    expect(apps.held).toHaveLength(1);
  });

  it('refuses an actor without gateway:slack', async () => {
    await expect(removeBot('A02', { ...ANA, scopes: [] })).resolves.toMatchObject({ isOk: false, error: { kind: 'SLACK_SCOPE_NOT_HELD' } });
  });
});
