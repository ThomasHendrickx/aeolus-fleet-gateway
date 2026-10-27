import { idSchema } from '@aeolus-fleet/common';

import type { SlackApps, SlackWorkspaces } from '../../core/slack/ports.js';
import type { SlackApp } from '../../core/slack/slack-app.js';
import type { SlackWorkspace } from '../../core/slack/slack-workspace.js';
import type { PrismaClient } from './client.js';
import type { SlackApp as SlackAppRow, SlackWorkspace as SlackWorkspaceRow } from './generated/client.js';

/** How long a change holding a workspace may take: a rotation waits on Slack. */
const CHANGE_TIMEOUT_MS = 30_000;

function workspaceOf(row: SlackWorkspaceRow): SlackWorkspace {
  return {
    fleetId: idSchema('fleet').parse(row.fleetId),
    teamId: row.teamId,
    teamName: row.teamName,
    connectedBy: { shipId: idSchema('ship').parse(row.connectedByShipId), name: row.connectedByName },
    connectedAt: row.connectedAt,
    token: { accessToken: row.configAccessToken, refreshToken: row.configRefreshToken, expiresAt: row.configExpiresAt },
    isTokenRefused: row.isConfigRefused,
  };
}

function rowOf(workspace: SlackWorkspace): Omit<SlackWorkspaceRow, 'fleetId'> {
  return {
    teamId: workspace.teamId,
    teamName: workspace.teamName,
    connectedByShipId: workspace.connectedBy.shipId,
    connectedByName: workspace.connectedBy.name,
    connectedAt: workspace.connectedAt,
    configAccessToken: workspace.token.accessToken,
    configRefreshToken: workspace.token.refreshToken,
    configExpiresAt: workspace.token.expiresAt,
    isConfigRefused: workspace.isTokenRefused,
  };
}

function appOf(row: SlackAppRow): SlackApp {
  return {
    fleetId: idSchema('fleet').parse(row.fleetId),
    appId: row.appId,
    shipId: row.shipId === null ? null : idSchema('ship').parse(row.shipId),
    clientId: row.clientId,
    clientSecret: row.clientSecret,
    signingSecret: row.signingSecret,
    installUrl: row.installUrl,
    madeAt: row.madeAt,
    bot: row.botToken === null || row.botUserId === null ? null : { token: row.botToken, userId: row.botUserId },
  };
}

/** Each fleet's Slack workspace, one row per fleet; a change holds its row (FOR UPDATE) until it is kept. */
export function createPrismaSlackWorkspaces(db: PrismaClient): SlackWorkspaces {
  return {
    find: async (fleetId) => {
      const row = await db.slackWorkspace.findUnique({ where: { fleetId } });
      return row === null ? undefined : workspaceOf(row);
    },
    rotatable: async () => {
      const rows = await db.slackWorkspace.findMany({ where: { isConfigRefused: false }, select: { fleetId: true }, orderBy: { fleetId: 'asc' } });
      return rows.map(({ fleetId }) => idSchema('fleet').parse(fleetId));
    },
    save: async (workspace) => {
      const row = rowOf(workspace);
      await db.slackWorkspace.upsert({ where: { fleetId: workspace.fleetId }, create: { fleetId: workspace.fleetId, ...row }, update: row });
    },
    change: (fleetId, change) =>
      db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM "slack_workspaces" WHERE "fleet_id" = ${fleetId} FOR UPDATE`;
          const row = await tx.slackWorkspace.findUnique({ where: { fleetId } });
          if (row === null) {
            return undefined;
          }
          const changed = await change(workspaceOf(row));
          await tx.slackWorkspace.update({ where: { fleetId }, data: rowOf(changed) });
          return changed;
        },
        { timeout: CHANGE_TIMEOUT_MS },
      ),
    remove: async (fleetId) => {
      await db.$transaction([db.slackApp.deleteMany({ where: { fleetId } }), db.slackWorkspace.deleteMany({ where: { fleetId } })]);
    },
  };
}

/** The Slack apps the gateway made, by fleet and app id. */
export function createPrismaSlackApps(db: PrismaClient): SlackApps {
  return {
    gatewayBot: async (fleetId) => {
      const row = await db.slackApp.findFirst({ where: { fleetId, shipId: null } });
      return row === null ? undefined : appOf(row);
    },
    all: async (fleetId) => (await db.slackApp.findMany({ where: { fleetId }, orderBy: { madeAt: 'asc' } })).map(appOf),
    find: async (fleetId, appId) => {
      const row = await db.slackApp.findUnique({ where: { fleetId_appId: { fleetId, appId } } });
      return row === null ? undefined : appOf(row);
    },
    save: async (app) => {
      const row = { shipId: app.shipId, clientId: app.clientId, clientSecret: app.clientSecret, signingSecret: app.signingSecret, installUrl: app.installUrl, madeAt: app.madeAt, botToken: app.bot?.token ?? null, botUserId: app.bot?.userId ?? null };
      await db.slackApp.upsert({ where: { fleetId_appId: { fleetId: app.fleetId, appId: app.appId } }, create: { fleetId: app.fleetId, appId: app.appId, ...row }, update: row });
    },
  };
}
