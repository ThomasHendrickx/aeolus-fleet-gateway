import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aSlackApp, aSlackLink, aSlackWorkspace, memorySlackApps, memorySlackLinks, memorySlackWorkspaces } from '../../../test/support/slack-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import { createReadSlackLink } from './read-slack-link.js';

// The Overview shows each person their Slack link (gateway scopes 9.6):
// "Slack linked as @mathilde in Acme", or Link Slack, once the fleet's own
// bot is in its workspace.

const MATHILDE: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc-mathilde', personShipId: 'shp_01m3tbfspe96yf1rnr4ank9m4t', accountToken: 'account-token-1', scopes: [] };

let workspaces: ReturnType<typeof memorySlackWorkspaces>;
let apps: ReturnType<typeof memorySlackApps>;
let links: ReturnType<typeof memorySlackLinks>;

beforeEach(async () => {
  workspaces = memorySlackWorkspaces();
  apps = memorySlackApps();
  links = memorySlackLinks();
  await workspaces.save(aSlackWorkspace({ teamName: 'Acme' }));
  await apps.save(aSlackApp({ bot: { token: 'xoxb-A01', userId: 'U0A01' } }));
});

function readSlackLink(actor: Actor = MATHILDE) {
  return createReadSlackLink({ workspaces, apps, links })({ actor });
}

describe("a person's Slack link on the Overview", () => {
  it('shows the Slack name it is linked as, in the workspace', async () => {
    await links.add(aSlackLink());

    await expect(readSlackLink()).resolves.toEqual({ workspaceName: 'Acme', link: { slackName: 'mathilde' } });
  });

  it('offers Link Slack while the account is not linked', async () => {
    await links.add(aSlackLink({ accountId: 'acc-joris', slackUserId: 'U0JORIS' }));

    await expect(readSlackLink()).resolves.toEqual({ workspaceName: 'Acme', link: null });
  });

  it("offers nothing while the fleet's own bot is not in Slack", async () => {
    await apps.save(aSlackApp());

    await expect(readSlackLink()).resolves.toBeNull();
  });

  it('offers nothing while the fleet is connected to no Slack workspace', async () => {
    await workspaces.remove(FLEET_ID);

    await expect(readSlackLink()).resolves.toBeNull();
  });

  it('offers nothing to an account with no person ship in the fleet', async () => {
    await expect(readSlackLink({ ...MATHILDE, personShipId: null })).resolves.toBeNull();
  });
});
