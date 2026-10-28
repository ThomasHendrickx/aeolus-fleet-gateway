import type { FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaSlackApps, createPrismaSlackWorkspaces } from '../src/adapters/prisma/slack-stores.js';
import type { SlackApp } from '../src/core/slack/slack-app.js';
import { migratedDatabase } from './support/database.js';
import { aSlackWorkspace } from './support/slack-fakes.js';

// The gateway's vault keeps each fleet's Slack workspace with its
// configuration token, and the apps it made with their secrets and bot
// tokens (gateway scopes 9.1). A rotation holds the workspace, so two never
// spend one single-use refresh token.

const ACME: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const LABS: FleetId = 'flt_01m4ajt7abh4rypkmdnjene67g';
const AT = new Date('2026-10-27T09:00:00.000Z');
const BOT: SlackApp = { fleetId: ACME, appId: 'A01', shipId: null, clientId: 'client-A01', clientSecret: 'secret-A01', signingSecret: 'signing-A01', installUrl: 'https://slack.com/oauth/v2/authorize?client_id=client-A01', name: 'Acme', madeAt: AT, installStartedAt: null, removedInSlackAt: null, bot: null };

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Slack workspaces in the gateway's vault", () => {
  it('keeps a workspace per fleet, read back whole, and lists the ones whose token Slack has not refused', async () => {
    const workspaces = createPrismaSlackWorkspaces(prisma);
    await workspaces.save(aSlackWorkspace({ fleetId: ACME }));
    await workspaces.save(aSlackWorkspace({ fleetId: LABS, teamName: 'Labs', isTokenRefused: true }));

    await expect(Promise.all([workspaces.find(ACME), workspaces.rotatable()])).resolves.toEqual([aSlackWorkspace({ fleetId: ACME }), [ACME]]);
  });

  it('runs one change at a time holding the workspace, the second seeing what the first kept', async () => {
    const workspaces = createPrismaSlackWorkspaces(prisma);
    await workspaces.save(aSlackWorkspace({ fleetId: ACME }));
    const seen = new Array<string>();
    const rotate = (next: string) => (workspace: ReturnType<typeof aSlackWorkspace>) => {
      seen.push(workspace.token.refreshToken);
      return new Promise<ReturnType<typeof aSlackWorkspace>>((resolve) => setTimeout(() => { resolve({ ...workspace, token: { ...workspace.token, refreshToken: next } }); }, 50));
    };

    await Promise.all([workspaces.change(ACME, rotate('xoxe-1-second')), workspaces.change(ACME, rotate('xoxe-1-third'))]);

    expect(seen).toHaveLength(2);
    expect(seen[1]).not.toBe(seen[0]);
  });

  it('changes nothing for a fleet connected to no workspace', async () => {
    await expect(createPrismaSlackWorkspaces(prisma).change('flt_01m4ajt7abh4rypkmdnjene6zz', (workspace) => Promise.resolve(workspace))).resolves.toBeUndefined();
  });
});

describe("Slack apps in the gateway's vault", () => {
  it("keeps the gateway's bot, then its bot token once installed", async () => {
    const apps = createPrismaSlackApps(prisma);
    await apps.save(BOT);
    await apps.save({ ...BOT, bot: { token: 'xoxb-A01', userId: 'U0A01' } });

    await expect(Promise.all([apps.gatewayBot(ACME), apps.find(ACME, 'A01'), apps.all(ACME)])).resolves.toEqual([
      { ...BOT, bot: { token: 'xoxb-A01', userId: 'U0A01' } },
      { ...BOT, bot: { token: 'xoxb-A01', userId: 'U0A01' } },
      [{ ...BOT, bot: { token: 'xoxb-A01', userId: 'U0A01' } }],
    ]);
  });

  it("finds a ship's bot by the ship and by its app id alone, and forgets one bot", async () => {
    const apps = createPrismaSlackApps(prisma);
    const shipBot: SlackApp = { ...BOT, appId: 'A05', shipId: 'shp_01m3tbfspe96yf1rnr4ank9r1n', name: 'release-notes', installStartedAt: AT, removedInSlackAt: AT };
    await apps.save(shipBot);

    await expect(Promise.all([apps.ofShip(ACME, 'shp_01m3tbfspe96yf1rnr4ank9r1n'), apps.findByAppId('A05')])).resolves.toEqual([shipBot, shipBot]);
    await apps.remove(ACME, 'A05');
    await expect(apps.findByAppId('A05')).resolves.toBeUndefined();
  });

  it('forgets the workspace with every app made in it, and the fleet whole', async () => {
    const workspaces = createPrismaSlackWorkspaces(prisma);
    const apps = createPrismaSlackApps(prisma);
    await workspaces.save(aSlackWorkspace({ fleetId: LABS }));
    await apps.save({ ...BOT, fleetId: LABS });
    await workspaces.remove(LABS);
    await workspaces.save(aSlackWorkspace({ fleetId: ACME }));
    await apps.save(BOT);
    await createPrismaFleetForgetter(prisma).forget(ACME);

    await expect(Promise.all([workspaces.find(LABS), apps.all(LABS), workspaces.find(ACME), apps.all(ACME)])).resolves.toEqual([undefined, [], undefined, []]);
  });
});
