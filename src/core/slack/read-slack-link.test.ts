import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { FLEET_ID, memoryConnectionStore, SHIP_ID } from '../../../test/support/fleet-fakes.js';
import { fakeCallSender } from '../../../test/support/mcp-in-fakes.js';
import { aSlackApp, aSlackLink, aSlackWorkspace, memorySlackApps, memorySlackLinks, memorySlackLinkSteps, memorySlackWorkspaces } from '../../../test/support/slack-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import { createAskToLinkSlack } from './ask-to-link-slack.js';
import { createReadSlackLink } from './read-slack-link.js';

// Bridge's settings show each person their Slack link (gateway scopes 9.6):
// "Slack linked as @mathilde in Acme", or Link Slack, once the fleet's own
// bot is in its workspace. Not linked, they are asked to link Slack by a step
// (BG7).

const MATHILDE: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc-mathilde', personShipId: 'shp_01m3tbfspe96yf1rnr4ank9m4t', accountToken: 'account-token-1', scopes: [] };

let workspaces: ReturnType<typeof memorySlackWorkspaces>;
let apps: ReturnType<typeof memorySlackApps>;
let links: ReturnType<typeof memorySlackLinks>;
let sender: ReturnType<typeof fakeCallSender>;
let connections: ReturnType<typeof memoryConnectionStore>;

beforeEach(async () => {
  workspaces = memorySlackWorkspaces();
  apps = memorySlackApps();
  links = memorySlackLinks();
  sender = fakeCallSender();
  connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: new Date('2026-10-25T09:00:00.000Z') });
  await workspaces.save(aSlackWorkspace({ teamName: 'Acme' }));
  await apps.save(aSlackApp({ bot: { token: 'xoxb-A01', userId: 'U0A01' } }));
});

function readSlackLink(actor: Actor = MATHILDE) {
  const askToLink = createAskToLinkSlack({ steps: memorySlackLinkSteps(), connections, sender, newStepId: () => '0b7e4c52-1f3a-4d6e-8b2c-5a9d1e7f3c21', linkUrlOf: (fleetId) => `https://gateway.example.com/slack/link?fleet=${fleetId}` });
  return createReadSlackLink({ workspaces, apps, links, askToLink })({ actor });
}

/** Who was asked to link Slack, by the step's title. */
const asked = () => sender.sent.map(({ to, payload }) => ({ to, title: z.object({ title: z.string() }).parse(JSON.parse(payload)).title }));

describe("a person's Slack link on Bridge", () => {
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

describe('a person opening Bridge\'s settings with no Slack link (BG7)', () => {
  it('is asked to link Slack by a step to their person ship', async () => {
    await readSlackLink();

    expect(asked()).toEqual([{ to: 'shp_01m3tbfspe96yf1rnr4ank9m4t', title: 'Link Slack' }]);
  });

  it('is asked nothing while linked', async () => {
    await links.add(aSlackLink());

    await readSlackLink();

    expect(asked()).toEqual([]);
  });

  it("is asked nothing while the fleet's own bot is not in Slack", async () => {
    await apps.save(aSlackApp());

    await readSlackLink();

    expect(asked()).toEqual([]);
  });
});
