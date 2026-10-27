import type { FleetId } from '@aeolus-fleet/common';

import type { InstallState, InstallStates, MadeApp, SlackApps, SlackRefusal, SlackTooling, SlackWorkspaces } from '../../src/core/slack/ports.js';
import type { SlackApp, SlackAppDescription } from '../../src/core/slack/slack-app.js';
import type { SlackWorkspace } from '../../src/core/slack/slack-workspace.js';
import { err, ok } from '../../src/core/shared/result.js';

/** How long Slack's configuration access token lives. */
const CONFIGURATION_TOKEN_MS = 12 * 60 * 60 * 1000;

/**
 * Slack's app management in memory: refresh tokens it takes once each, the
 * apps it made and removed, and installs by code. Each refresh token it
 * issues is good once; the test turns Slack away or rate limits it.
 */
export function fakeSlackTooling(options: { teamId?: string; teamName?: string; now?: () => Date } = {}) {
  const teamId = options.teamId ?? 'T0ACME';
  const now = options.now ?? (() => new Date('2026-10-27T09:00:00.000Z'));
  const state = {
    /** Refresh tokens Slack takes, each once. */
    refreshTokens: new Set<string>(['xoxe-1-first']),
    rotations: 0,
    made: new Array<{ accessToken: string; description: SlackAppDescription; appId: string }>(),
    removed: new Array<{ accessToken: string; appId: string }>(),
    installs: new Array<{ clientId: string; code: string; redirectUrl: string }>(),
    /** Codes Slack's install screen sent back, each for its app. */
    codes: new Map<string, string>(),
    /** What Slack answers every call with instead, while set. */
    refusal: undefined as SlackRefusal | undefined,
    /** What Slack answers making an app with instead, while set. */
    makeRefusal: undefined as SlackRefusal | undefined,
  };
  const issued = (count: number) => ({ accessToken: `xoxe.xoxp-${String(count)}`, refreshToken: `xoxe-1-${String(count)}`, expiresAt: new Date(now().getTime() + CONFIGURATION_TOKEN_MS) });
  const slack: SlackTooling = {
    rotateConfigurationToken: (refreshToken) => {
      if (state.refusal !== undefined) {
        return Promise.resolve(err(state.refusal));
      }
      if (!state.refreshTokens.delete(refreshToken)) {
        return Promise.resolve(err({ kind: 'refused' as const, error: 'invalid_refresh_token' }));
      }
      state.rotations += 1;
      const token = issued(state.rotations);
      state.refreshTokens.add(token.refreshToken);
      return Promise.resolve(ok({ token, teamId }));
    },
    makeApp: (accessToken, description) => {
      const refusal = state.refusal ?? state.makeRefusal;
      if (refusal !== undefined) {
        return Promise.resolve(err(refusal));
      }
      const appId = `A0${String(state.made.length + 1)}`;
      state.made.push({ accessToken, description, appId });
      const made: MadeApp = { appId, clientId: `client-${appId}`, clientSecret: `secret-${appId}`, signingSecret: `signing-${appId}`, installUrl: `https://slack.com/oauth/v2/authorize?client_id=client-${appId}` };
      return Promise.resolve(ok(made));
    },
    removeApp: (accessToken, appId) => {
      if (state.refusal !== undefined) {
        return Promise.resolve(err(state.refusal));
      }
      state.removed.push({ accessToken, appId });
      return Promise.resolve(ok(undefined));
    },
    completeInstall: ({ clientId, code, redirectUrl }) => {
      if (state.refusal !== undefined) {
        return Promise.resolve(err(state.refusal));
      }
      state.installs.push({ clientId, code, redirectUrl });
      const appId = state.codes.get(code);
      if (appId === undefined || `client-${appId}` !== clientId) {
        return Promise.resolve(err({ kind: 'refused' as const, error: 'invalid_code' }));
      }
      return Promise.resolve(ok({ appId, teamId, teamName: options.teamName ?? 'Acme', botToken: `xoxb-${appId}`, botUserId: `U0${appId}` }));
    },
  };
  return { state, slack };
}

/** Each fleet's Slack workspace in memory, with how many changes ran holding it. */
export function memorySlackWorkspaces(): SlackWorkspaces & { held: Map<FleetId, SlackWorkspace> } {
  const held = new Map<FleetId, SlackWorkspace>();
  return {
    held,
    find: (fleetId) => Promise.resolve(held.get(fleetId)),
    rotatable: () => Promise.resolve([...held.values()].filter((workspace) => !workspace.isTokenRefused).map(({ fleetId }) => fleetId)),
    save: (workspace) => {
      held.set(workspace.fleetId, workspace);
      return Promise.resolve();
    },
    change: async (fleetId, change) => {
      const workspace = held.get(fleetId);
      if (workspace === undefined) {
        return undefined;
      }
      const changed = await change(workspace);
      held.set(fleetId, changed);
      return changed;
    },
    remove: (fleetId) => {
      held.delete(fleetId);
      return Promise.resolve();
    },
  };
}

/** The Slack apps the gateway made, in memory, by fleet and app id. */
export function memorySlackApps(): SlackApps & { held: SlackApp[] } {
  const held = new Array<SlackApp>();
  const indexOf = (fleetId: FleetId, appId: string) => held.findIndex((app) => app.fleetId === fleetId && app.appId === appId);
  return {
    held,
    gatewayBot: (fleetId) => Promise.resolve(held.find((app) => app.fleetId === fleetId && app.shipId === null)),
    all: (fleetId) => Promise.resolve(held.filter((app) => app.fleetId === fleetId)),
    find: (fleetId, appId) => Promise.resolve(held.find((app) => app.fleetId === fleetId && app.appId === appId)),
    save: (app) => {
      const index = indexOf(app.fleetId, app.appId);
      if (index === -1) {
        held.push(app);
      } else {
        held[index] = app;
      }
      return Promise.resolve();
    },
  };
}

/** Install states as readable text: a test reads what the gateway sealed. */
export function plainInstallStates(): InstallStates {
  return {
    seal: (state) => JSON.stringify({ ...state, expiresAt: state.expiresAt.toISOString() }),
    open: (sealed) => {
      try {
        const parsed: unknown = JSON.parse(sealed);
        if (typeof parsed !== 'object' || parsed === null || !('fleetId' in parsed) || !('appId' in parsed) || !('expiresAt' in parsed)) {
          return undefined;
        }
        const { fleetId, appId, expiresAt } = parsed;
        return typeof fleetId === 'string' && fleetId.startsWith('flt_') && typeof appId === 'string' && typeof expiresAt === 'string' ? ({ fleetId: fleetId as FleetId, appId, expiresAt: new Date(expiresAt) } satisfies InstallState) : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

/** A fleet's workspace as connected by Charlotte, its configuration token fresh unless the test says otherwise. */
export function aSlackWorkspace(overrides: Partial<SlackWorkspace> = {}): SlackWorkspace {
  return {
    fleetId: 'flt_01m3tb1zgr5h2ffee12xnch8sv',
    teamId: 'T0ACME',
    teamName: null,
    connectedBy: { shipId: 'shp_01m3tbfspe96yf1rnr4ank9c4r', name: 'charlotte' },
    connectedAt: new Date('2026-10-27T08:00:00.000Z'),
    token: { accessToken: 'xoxe.xoxp-kept', refreshToken: 'xoxe-1-first', expiresAt: new Date('2026-10-27T20:00:00.000Z') },
    isTokenRefused: false,
    ...overrides,
  };
}
