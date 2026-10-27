import { idSchema, type FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { commission, register, signIn } from './support/argo.js';
import { charlotteIn, PAGASAE_APP_CLIENT, PAGASAE_CLIENT, startFakePagasae, type FakePagasae } from './support/fake-pagasae.js';
import { startFakeSlack, type FakeSlack } from './support/fake-slack.js';
import { aFreePort, aNewDatabaseUrl, startFleetServer, type FleetServer } from './support/fleet-server.js';
import { connectGateway } from './support/gateway-api.js';
import { startGateway, type RunningGateway } from './support/gateway-bin.js';
import { TEST_GATEWAY_SECRET } from './support/mcp-client.js';

// Gateway scopes S5: an account holding gateway:slack connects the fleet to
// a Slack workspace on the Slack page, the gateway makes its own bot and the
// account installs it; a token Slack refuses, or one that ends refused
// later, is shown. Slack is the double; the gateway, its web app and the
// fleet are real.

const STARTUP_MS = 60_000;
const POLL_MS = 250;
const HOLDER_SIGN_IN = 'charlotte-slack-shared-sign-in';
const READER_SIGN_IN = 'charlotte-reads-shared-sign-in';

let fleet: FleetServer;
let pagasae: FakePagasae;
let slack: FakeSlack;
let gateway: RunningGateway | undefined;
let address: string;
let fleetId: FleetId;
let prisma: PrismaClient;

/** A page's text as a person reads it: its tags gone, its spaces as one. */
function textOf(html: string): string {
  return html.replaceAll(/<[^>]*>/g, '').replaceAll(/\s+/g, ' ').replaceAll('&#x27;', "'");
}

/** The hidden fields of the form with this test id, as the page rendered them before its script took over. */
function hiddenFieldsOf(html: string, testId: string): FormData {
  const form = new FormData();
  const start = html.indexOf(`data-testid="${testId}"`);
  const section = html.slice(start, html.indexOf('</form>', start));
  for (const [, name = '', value = ''] of section.matchAll(/<input type="hidden" name="([^"]*)"(?: value="([^"]*)")?/g)) {
    form.append(name.replaceAll('&quot;', '"').replaceAll('&amp;', '&'), value.replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
  }
  return form;
}

function pageHeaders(signIn: string) {
  return { accept: 'text/html', cookie: `aeolus_account_session=${signIn}` };
}

async function slackPage(signIn = HOLDER_SIGN_IN): Promise<string> {
  return (await fetch(`${address}/slack?fleet=${fleetId}`, { headers: pageHeaders(signIn) })).text();
}

/** Sends a form of the Slack page, as before the page's script took over. */
async function sent(testId: string, fields: Record<string, string> = {}, path = '/slack'): Promise<Response> {
  const page = await (await fetch(`${address}${path}?fleet=${fleetId}`, { headers: pageHeaders(HOLDER_SIGN_IN) })).text();
  const form = hiddenFieldsOf(page, testId);
  for (const [name, value] of Object.entries(fields)) {
    form.append(name, value);
  }
  return fetch(`${address}${path}?fleet=${fleetId}`, { method: 'POST', headers: { ...pageHeaders(HOLDER_SIGN_IN), origin: address }, body: form, redirect: 'manual' });
}

beforeAll(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  pagasae = await startFakePagasae();
  slack = await startFakeSlack();
  const cookie = await signIn(fleet);
  const gatewayShip = await commission(fleet, { cookie, ship: { name: 'gateway', type: 'gateway', kind: 'app', scopes: ['fleet:read', 'fleet:commission', 'fleet:on-behalf', 'scopes:declare', 'fleet:verify'] } });
  const charlotte = await commission(fleet, { cookie, ship: { name: 'charlotte', type: 'person', kind: 'person' } });
  const crewToken = await register(fleet, await commission(fleet, { cookie, ship: { name: 'reader', type: 'agent' } }));
  const whoami = await fetch(`${fleet.url}/api/v1/ship/whoami`, { headers: { authorization: `Bearer ${crewToken}` } });
  fleetId = z.object({ fleetId: idSchema('fleet') }).parse(await whoami.json()).fleetId;
  pagasae.sharedSignIn(HOLDER_SIGN_IN, { ...charlotteIn(pagasae, fleetId), scope: 'fleet:read gateway:slack', person_ship: charlotte.shipId });
  pagasae.sharedSignIn(READER_SIGN_IN, { ...charlotteIn(pagasae, fleetId), person_ship: charlotte.shipId });
  const port = await aFreePort();
  address = `http://127.0.0.1:${String(port)}`;
  const databaseUrl = aNewDatabaseUrl(inject('postgresUrl'), 'gateway');
  gateway = startGateway({
    DATABASE_URL: databaseUrl,
    FLEET_URL: fleet.url,
    PORT: String(port),
    GATEWAY_PUBLIC_URL: address,
    LOG_LEVEL: 'silent',
    GATEWAY_SECRET: TEST_GATEWAY_SECRET,
    PAGASAE_URL: pagasae.url,
    PAGASAE_CLIENT_ID: PAGASAE_CLIENT.clientId,
    PAGASAE_CLIENT_SECRET: PAGASAE_CLIENT.clientSecret,
    PAGASAE_APP_CLIENT_ID: PAGASAE_APP_CLIENT.clientId,
    PAGASAE_APP_CLIENT_SECRET: PAGASAE_APP_CLIENT.clientSecret,
    SLACK_API_URL: slack.apiUrl,
  });
  // The gateway takes a moment to start, and its web app compiles as it is first asked.
  const deadline = Date.now() + STARTUP_MS;
  while ((await fetch(`${address}/api/health`).then((response) => response.status, () => undefined)) !== 200 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  expect((await connectGateway(address, { cookie, ...gatewayShip })).status).toBe(200);
  prisma = createPrismaClient(databaseUrl);
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await gateway?.stop();
  await slack.stop();
  await pagasae.stop();
  await fleet.stop();
});

describe('connecting Slack on the Slack page', () => {
  it('shows an account without gateway:slack the fleet connected to no workspace, read-only', async () => {
    const body = await slackPage(READER_SIGN_IN);

    expect({ hasForm: body.includes('data-testid="slack-connect-form"'), says: textOf(body).includes('Connecting Slack needs gateway:slack.') }).toEqual({ hasForm: false, says: true });
  }, 60_000);

  it('says Slack refused a configuration token, and connects nothing', async () => {
    const answer = await sent('slack-connect-form', { refreshToken: 'xoxe-1-expired' });

    expect(textOf(await answer.text())).toContain('Slack refused the configuration token (invalid_refresh_token): copy a new one from your Slack app management page');
    expect(await prisma.slackWorkspace.count()).toBe(0);
  }, 60_000);

  it("connects with a configuration token, makes the gateway's bot named after the fleet, and installs it through Slack's install screen", async () => {
    slack.issueRefreshToken('xoxe-1-good');

    const connected = textOf(await (await sent('slack-connect-form', { refreshToken: 'xoxe-1-good' })).text());
    const toSlack = await sent('slack-install-form');
    const back = await fetch(toSlack.headers.get('location') ?? '', { redirect: 'manual' });
    const installed = await fetch(back.headers.get('location') ?? '', { redirect: 'manual' });

    expect(connected).toContain("Slack is connected, and the gateway's bot is made: install it");
    expect([...slack.apps.values()].map(({ manifest }) => z.object({ display_information: z.object({ name: z.string() }) }).parse(manifest).display_information.name)).toEqual(['Acme']);
    expect(installed.headers.get('location')).toBe(`/slack?fleet=${fleetId}&install=installed`);
    const page = textOf(await slackPage());
    expect(['Acme', 'Connected by charlotte', 'Configuration token fresh', 'In Slack', "The gateway's bot is in Slack"].map((text) => page.includes(text) || text)).toEqual([true, true, true, true, "The gateway's bot is in Slack"]);
  }, 60_000);

  it('shows a configuration token Slack refused later, with Connect again', async () => {
    // Slack revoked the kept token: its next rotation, due now, is refused.
    await prisma.slackWorkspace.updateMany({ data: { configExpiresAt: new Date(), configRefreshToken: 'xoxe-1-revoked' } });

    const refused = textOf(await (await sent('slack-disconnect-form', {}, '/slack/disconnect')).text());

    expect(refused).toContain('Slack refused the configuration token. Connect again to make or change bots; bots already installed keep working');
    const page = await slackPage();
    expect({ says: textOf(page).includes('Slack refused the configuration token. Connect again'), hasConnectAgain: page.includes('data-testid="slack-connect-form"') }).toEqual({ says: true, hasConnectAgain: true });
  }, 60_000);

  it('connects again with a new token of the workspace, then disconnects, removing the gateway\'s bot in Slack', async () => {
    slack.issueRefreshToken('xoxe-1-again');
    await sent('slack-connect-form', { refreshToken: 'xoxe-1-again' });

    const disconnected = await sent('slack-disconnect-form', {}, '/slack/disconnect');

    expect(disconnected.status).toBe(303);
    expect([...slack.apps.values()].map(({ isRemoved }) => isRemoved)).toEqual([true]);
    expect(await slackPage()).toContain('data-testid="slack-not-connected"');
  }, 60_000);
});
