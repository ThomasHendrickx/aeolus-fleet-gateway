import { createHmac } from 'node:crypto';

import { FLEET_HEADER, idSchema, type FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { commission, register, signIn } from './support/argo.js';
import { charlotteIn, PAGASAE_APP_CLIENT, PAGASAE_CLIENT, startFakePagasae, type FakePagasae } from './support/fake-pagasae.js';
import { startFakeSlack, type FakeSlack } from './support/fake-slack.js';
import { aFreePort, aNewDatabaseUrl, startFleetServer, type FleetServer } from './support/fleet-server.js';
import { connectGateway, mutate, query } from './support/gateway-api.js';
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
let argoCookie: string;
let charlotteShip: Awaited<ReturnType<typeof commission>>;

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
async function sent(testId: string, form: { fields?: Record<string, string>; path?: string } = {}): Promise<Response> {
  const { fields = {}, path = '/slack' } = form;
  const page = await (await fetch(`${address}${path}?fleet=${fleetId}`, { headers: pageHeaders(HOLDER_SIGN_IN) })).text();
  const body = hiddenFieldsOf(page, testId);
  for (const [name, value] of Object.entries(fields)) {
    body.append(name, value);
  }
  return fetch(`${address}${path}?fleet=${fleetId}`, { method: 'POST', headers: { ...pageHeaders(HOLDER_SIGN_IN), origin: address }, body, redirect: 'manual' });
}

beforeAll(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  pagasae = await startFakePagasae();
  slack = await startFakeSlack();
  const cookie = await signIn(fleet);
  argoCookie = cookie;
  const gatewayShip = await commission(fleet, { cookie, ship: { name: 'gateway', type: 'gateway', kind: 'app', scopes: ['fleet:read', 'fleet:commission', 'fleet:on-behalf', 'scopes:declare', 'fleet:verify'] } });
  const charlotte = await commission(fleet, { cookie, ship: { name: 'charlotte', type: 'person', kind: 'person' } });
  charlotteShip = charlotte;
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
    const answer = await sent('slack-connect-form', { fields: { refreshToken: 'xoxe-1-expired' } });

    expect(textOf(await answer.text())).toContain('Slack refused the configuration token (invalid_refresh_token): copy a new one from your Slack app management page');
    expect(await prisma.slackWorkspace.count()).toBe(0);
  }, 60_000);

  it("connects with a configuration token, makes the gateway's bot named after the fleet, and installs it through Slack's install screen", async () => {
    slack.issueRefreshToken('xoxe-1-good');

    const connected = textOf(await (await sent('slack-connect-form', { fields: { refreshToken: 'xoxe-1-good' } })).text());
    const toSlack = await sent('slack-install-form');
    expect(toSlack.headers.get('location'), textOf(await toSlack.clone().text()).slice(0, 3000)).toBeTruthy();
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

    const refused = textOf(await (await sent('slack-disconnect-form', { path: '/slack/disconnect' })).text());

    expect(refused).toContain('Slack refused the configuration token. Connect again to make or change bots; bots already installed keep working');
    const page = await slackPage();
    expect({ says: textOf(page).includes('Slack refused the configuration token. Connect again'), hasConnectAgain: page.includes('data-testid="slack-connect-form"') }).toEqual({ says: true, hasConnectAgain: true });
  }, 60_000);

  it('connects again with a new token of the workspace, then disconnects, removing the gateway\'s bot in Slack', async () => {
    slack.issueRefreshToken('xoxe-1-again');
    await sent('slack-connect-form', { fields: { refreshToken: 'xoxe-1-again' } });

    const disconnected = await sent('slack-disconnect-form', { path: '/slack/disconnect' });

    expect(disconnected.status).toBe(303);
    expect([...slack.apps.values()].map(({ isRemoved }) => isRemoved)).toEqual([true]);
    expect(await slackPage()).toContain('data-testid="slack-not-connected"');
  }, 60_000);
});

describe('a ship as a Slack bot (gateway scopes S6)', () => {
  /** A tRPC answer's data. */
  async function dataOf<D>(response: Response, data: z.ZodType<D>): Promise<D> {
    expect(response.status, await response.clone().text()).toBe(200);
    return data.parse(z.object({ result: z.object({ data: z.unknown() }) }).parse(await response.json()).result.data);
  }

  it("exposes an agent ship by its id, installs its bot, shows it Removed in Slack once Slack says so, and removes it", async () => {
    slack.issueRefreshToken('xoxe-1-s6');
    await sent('slack-connect-form', { fields: { refreshToken: 'xoxe-1-s6' } });
    const releaseNotes = await commission(fleet, { cookie: argoCookie, ship: { name: 'release-notes', type: 'agent' } });
    const admin = await register(fleet, await commission(fleet, { cookie: argoCookie, ship: { name: 'slack-admin', type: 'agent', scopes: ['fleet:read', 'fleet:manage', 'gateway:slack'] } }));

    const offered = await dataOf(await query(address, { procedure: 'slack.exposable', crewToken: admin }), z.array(z.object({ shipId: z.string(), name: z.string() })));
    const { appId } = await dataOf(await mutate(address, { procedure: 'slack.expose', crewToken: admin, body: { shipId: releaseNotes.shipId } }), z.object({ appId: z.string() }));
    const made = textOf(await slackPage());
    const { url } = await dataOf(await mutate(address, { procedure: 'slack.install', crewToken: admin, body: { appId } }), z.object({ url: z.string() }));
    const back = await fetch(url, { redirect: 'manual' });
    await fetch(back.headers.get('location') ?? '', { redirect: 'manual' });
    const inSlack = textOf(await slackPage());

    expect(offered.map(({ name }) => name)).toContain('release-notes');
    expect(z.object({ display_information: z.object({ name: z.string() }) }).parse(slack.apps.get(appId)?.manifest).display_information.name).toBe('release-notes');
    expect([made.includes('release-notes') && made.includes('Made'), inSlack.includes('release-notes') && inSlack.includes('In Slack')]).toEqual([true, true]);

    const body = JSON.stringify({ type: 'event_callback', api_app_id: appId, team_id: 'T0ACME', event_id: 'Ev-uninstalled', event: { type: 'app_uninstalled' } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const event = await fetch(`${address}/gw/slack/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-slack-request-timestamp': timestamp, 'x-slack-signature': `v0=${createHmac('sha256', `signing-${appId}`).update(`v0:${timestamp}:${body}`).digest('hex')}` },
      body,
    });
    expect(event.status).toBe(200);
    expect(textOf(await slackPage())).toContain('Removed in Slack');

    await dataOf(await mutate(address, { procedure: 'slack.remove', crewToken: admin, body: { appId } }), z.object({}));
    expect({ isRemoved: slack.apps.get(appId)?.isRemoved, page: textOf(await slackPage()).includes('No ship is a Slack bot yet.') }).toEqual({ isRemoved: true, page: true });
  }, 60_000);

  it("answers Slack's address check at the events door as it makes an app", async () => {
    const answer = await fetch(`${address}/gw/slack/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'url_verification', token: 't', challenge: 'c-1' }) });

    expect(await answer.json()).toEqual({ challenge: 'c-1' });
  }, 60_000);
});

describe('linking a Slack account (gateway scopes S7)', () => {
  const JORIS_SIGN_IN = 'joris-shared-sign-in';
  let releaseNotesAppId = '';
  let releaseNotesCrew = '';

  /** Where a browser that follows each redirect by hand ends: the gateway, Slack's sign-in, the gateway again, in the browser of the sign-in that follows. */
  async function linked(signIn: string, followedBy = signIn): Promise<string> {
    const toSlack = await fetch(`${address}/slack/link?fleet=${fleetId}`, { headers: pageHeaders(signIn), redirect: 'manual' });
    expect(toSlack.status, await toSlack.clone().text()).toBeGreaterThanOrEqual(300);
    const back = await fetch(toSlack.headers.get('location') ?? '', { redirect: 'manual' });
    const done = await fetch(back.headers.get('location') ?? '', { headers: pageHeaders(followedBy), redirect: 'manual' });
    return done.headers.get('location') ?? '';
  }

  async function overview(signIn: string, path = `/overview?fleet=${fleetId}`): Promise<string> {
    return textOf(await (await fetch(`${address}${path}`, { headers: pageHeaders(signIn) })).text());
  }

  /** A Slack event for the app, signed with its signing secret as Slack signs it. */
  async function slackEvent(appId: string, event: Record<string, string>): Promise<Response> {
    const body = JSON.stringify({ type: 'event_callback', api_app_id: appId, team_id: 'T0ACME', event_id: `Ev-${String(Date.now())}`, event });
    const timestamp = String(Math.floor(Date.now() / 1000));
    return fetch(`${address}/gw/slack/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-slack-request-timestamp': timestamp, 'x-slack-signature': `v0=${createHmac('sha256', `signing-${appId}`).update(`v0:${timestamp}:${body}`).digest('hex')}` },
      body,
    });
  }

  beforeAll(async () => {
    slack.issueRefreshToken('xoxe-1-s7');
    await sent('slack-connect-form', { fields: { refreshToken: 'xoxe-1-s7' } });
    const toSlack = await sent('slack-install-form');
    const back = await fetch(toSlack.headers.get('location') ?? '', { redirect: 'manual' });
    await fetch(back.headers.get('location') ?? '', { redirect: 'manual' });
    // The gateway crewed each person ship at an earlier sign-in: the test core does not take the fake pagasae's account tokens to crew one.
    const joris = await commission(fleet, { cookie: argoCookie, ship: { name: 'joris', type: 'person', kind: 'person' } });
    for (const ship of [charlotteShip, joris]) {
      await prisma.personCrew.create({ data: { fleetId, shipId: ship.shipId, crewToken: await register(fleet, ship), crewedAt: new Date() } });
    }
    pagasae.sharedSignIn(JORIS_SIGN_IN, { ...charlotteIn(pagasae, fleetId), sub: 'acc-joris', person_ship: joris.shipId });
    const releaseNotes = await commission(fleet, { cookie: argoCookie, ship: { name: 'release-notes-s7', type: 'agent' } });
    const admin = await register(fleet, await commission(fleet, { cookie: argoCookie, ship: { name: 'slack-admin-s7', type: 'agent', scopes: ['fleet:read', 'fleet:manage', 'gateway:slack'] } }));
    const made = z.object({ result: z.object({ data: z.object({ appId: z.string() }) }) }).parse(await (await mutate(address, { procedure: 'slack.expose', crewToken: admin, body: { shipId: releaseNotes.shipId } })).json());
    releaseNotesAppId = made.result.data.appId;
    releaseNotesCrew = await register(fleet, releaseNotes);
    const installing = z.object({ result: z.object({ data: z.object({ url: z.string() }) }) }).parse(await (await mutate(address, { procedure: 'slack.install', crewToken: admin, body: { appId: releaseNotesAppId } })).json());
    const installed = await fetch(installing.result.data.url, { redirect: 'manual' });
    await fetch(installed.headers.get('location') ?? '', { redirect: 'manual' });
  }, 60_000);

  it('links a Slack account from the Overview, refuses a second link of it naming the first, and unlinks', async () => {
    slack.signInAs({ userId: 'U0CHARLOTTE', name: 'charlotte.d' });

    const unlinked = await overview(HOLDER_SIGN_IN);
    const charlottes = await linked(HOLDER_SIGN_IN);
    const linkedPage = await overview(HOLDER_SIGN_IN, charlottes);
    const joris = await linked(JORIS_SIGN_IN);
    const refusedPage = await overview(JORIS_SIGN_IN, joris);

    expect(unlinked).toContain('Not linked in Acme');
    expect(charlottes).toBe(`/overview?fleet=${fleetId}&slack=linked`);
    expect(['Slack linked as @charlotte.d in Acme', "Your Slack account is linked: message the fleet's bots in Slack"].map((text) => linkedPage.includes(text) || text)).toEqual([true, true]);
    expect(joris).toBe(`/overview?fleet=${fleetId}&slack=slack-user-linked&name=charlotte`);
    expect(refusedPage).toContain('This Slack account is linked to charlotte in this fleet already');

    const unlink = await fetch(`${address}/trpc/slack.unlink`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `aeolus_account_session=${HOLDER_SIGN_IN}`, [FLEET_HEADER]: fleetId }, body: '{}' });
    expect(unlink.status).toBe(200);
    expect(await overview(HOLDER_SIGN_IN)).toContain('Not linked in Acme');
  }, 60_000);

  it("refuses a link started by one account and followed in another's browser, linking neither", async () => {
    slack.signInAs({ userId: 'U0JORIS', name: 'joris.v' });

    const followed = await linked(HOLDER_SIGN_IN, JORIS_SIGN_IN);

    expect(followed).toBe('/overview?slack=refused');
    expect([await overview(HOLDER_SIGN_IN), await overview(JORIS_SIGN_IN)].map((page) => page.includes('Not linked in Acme'))).toEqual([true, true]);
  }, 60_000);

  it("answers an unlinked person's message to a bot only they see, with a button to link, and the message never reaches the fleet", async () => {
    const answered = await slackEvent(releaseNotesAppId, { type: 'message', channel_type: 'im', channel: 'D0NEW', user: 'U0NEW', text: 'When is the release?', ts: '1730019600.000100' });

    expect(answered.status).toBe(200);
    const posted = slack.postedOnlyTo.at(-1);
    expect({ botToken: posted?.botToken, channel: posted?.form.channel, user: posted?.form.user, text: posted?.form.text }).toEqual({
      botToken: `xoxb-${releaseNotesAppId}`,
      channel: 'D0NEW',
      user: 'U0NEW',
      text: 'Link your Slack account to talk to release-notes-s7. Your message was not kept: send it again once linked.',
    });
    expect(posted?.form.blocks).toContain(`${address}/slack/link?fleet=${fleetId}`);
    const inbox = await fetch(`${fleet.url}/api/v1/ship/inbox`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${releaseNotesCrew}` }, body: JSON.stringify({ waitSeconds: 0 }) });
    expect(z.object({ waiting: z.number() }).parse(await inbox.json()).waiting).toBe(0);
  }, 60_000);
});
