import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { charlotteIn, PAGASAE_APP_CLIENT, PAGASAE_CLIENT, startFakePagasae, type FakePagasae } from './support/fake-pagasae.js';
import { aFreePort, aNewDatabaseUrl, startFleetServer, type FleetServer } from './support/fleet-server.js';
import { startGateway, type RunningGateway } from './support/gateway-bin.js';
import { TEST_GATEWAY_SECRET } from './support/mcp-client.js';

// The parties pages are the web app's (header design part 5): its server
// calls the gateway's API as the account the shared sign-in names, in the
// fleet the page's address names. Here pagasae is a fake; the gateway, its
// web app and the fleet are real.

const FLEET = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const SIGN_IN = 'charlotte-shared-sign-in';
const READER_SIGN_IN = 'charlotte-reads-shared-sign-in';
const APPROVER_SIGN_IN = 'charlotte-approves-shared-sign-in';
const LABS = 'flt_01m4ajt7abh4rypkmdnjene67g';
const SECOND_FLEET_SIGN_IN = 'charlotte-in-labs-first-shared-sign-in';
const UNLISTED_SIGN_IN = 'charlotte-pagasae-lists-nothing-shared-sign-in';
const STARTUP_MS = 60_000;
const POLL_MS = 250;
const PAGE = { accept: 'text/html', cookie: `aeolus_account_session=${SIGN_IN}` };

/** A page's text as a person reads it: its tags and React's text markers gone, its spaces as one. */
function textOf(html: string): string {
  return html.replaceAll(/<[^>]*>/g, '').replaceAll(/\s+/g, ' ');
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

let fleet: FleetServer;
let pagasae: FakePagasae;
let gateway: RunningGateway | undefined;
let address: string;

beforeAll(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  pagasae = await startFakePagasae();
  pagasae.sharedSignIn(SIGN_IN, { ...charlotteIn(pagasae, FLEET), scope: 'fleet:read fleet:network fleet:manage' });
  pagasae.sharedSignIn(READER_SIGN_IN, { ...charlotteIn(pagasae, FLEET), scope: 'fleet:read' });
  pagasae.sharedSignIn(APPROVER_SIGN_IN, { ...charlotteIn(pagasae, FLEET), scope: 'fleet:read gateway:approve' });
  pagasae.sharedSignIn(SECOND_FLEET_SIGN_IN, charlotteIn(pagasae, FLEET));
  pagasae.listFor(SECOND_FLEET_SIGN_IN, [
    { id: LABS, name: 'Labs' },
    { id: FLEET, name: 'Acme' },
  ]);
  pagasae.sharedSignIn(UNLISTED_SIGN_IN, charlotteIn(pagasae, FLEET));
  pagasae.listFor(UNLISTED_SIGN_IN, 'unavailable');
  const port = await aFreePort();
  address = `http://127.0.0.1:${String(port)}`;
  gateway = startGateway({
    DATABASE_URL: aNewDatabaseUrl(inject('postgresUrl'), 'gateway'),
    FLEET_URL: fleet.url,
    PORT: String(port),
    LOG_LEVEL: 'silent',
    GATEWAY_SECRET: TEST_GATEWAY_SECRET,
    PAGASAE_URL: pagasae.url,
    PAGASAE_CLIENT_ID: PAGASAE_CLIENT.clientId,
    PAGASAE_CLIENT_SECRET: PAGASAE_CLIENT.clientSecret,
    PAGASAE_APP_CLIENT_ID: PAGASAE_APP_CLIENT.clientId,
    PAGASAE_APP_CLIENT_SECRET: PAGASAE_APP_CLIENT.clientSecret,
  });
  // The gateway takes a moment to start, and its web app compiles as it is first asked.
  const deadline = Date.now() + STARTUP_MS;
  while ((await fetch(`${address}/api/health`).then((response) => response.status, () => undefined)) !== 200 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}, 120_000);

afterAll(async () => {
  await gateway?.stop();
  await pagasae.stop();
  await fleet.stop();
});

describe('the parties pages, as the account signed in', () => {
  it('shows the outside parties of the fleet the address names, with the switch for an account holding fleet:network', async () => {
    const page = await fetch(`${address}/outside-parties?fleet=${FLEET}`, { headers: PAGE });
    const body = await page.text();

    expect(page.status).toBe(200);
    expect(body).toContain('data-testid="outside-parties-turn"');
    expect(textOf(body)).toContain('Outside parties are off');
    expect(textOf(body)).toContain('No outside party yet.');
  }, 60_000);

  it('shows an account that only reads the fleet neither the switch nor Add server, and says what the switch needs', async () => {
    const page = await fetch(`${address}/outside-parties?fleet=${FLEET}`, { headers: { accept: 'text/html', cookie: `aeolus_account_session=${READER_SIGN_IN}` } });
    const body = await page.text();

    expect({ hasSwitch: body.includes('data-testid="outside-parties-turn"'), hasAdd: body.includes('data-testid="outside-parties-add"') }).toEqual({ hasSwitch: false, hasAdd: false });
    expect(textOf(body)).toContain('Turning them on or off needs fleet:network.');
  }, 60_000);

  it("sends the switch's form, before the page's script took over, to the API and says why the API refused it", async () => {
    const page = await (await fetch(`${address}/outside-parties?fleet=${FLEET}`, { headers: PAGE })).text();

    const answer = await fetch(`${address}/outside-parties?fleet=${FLEET}`, { method: 'POST', headers: { ...PAGE, origin: address }, body: hiddenFieldsOf(page, 'outside-parties-switch') });

    // The gateway connected to no fleet here, so the API refuses; the page says so beside the switch.
    expect(answer.status).toBe(200);
    expect(textOf(await answer.text())).toContain('Turn onThe gateway is not connected to your fleet');
  }, 60_000);

  it("says why the API refused a party's page, its change and its retire, with the way back to the list", async () => {
    const pages = ['/outside-parties/linear', '/outside-parties/linear/change', '/outside-parties/linear/retire'];

    const bodies = await Promise.all(pages.map(async (page) => (await fetch(`${address}${page}?fleet=${FLEET}`, { headers: PAGE })).text()));

    expect(bodies.map((body) => body.includes('role="alert"') && textOf(body).includes('← Outside parties'))).toEqual(pages.map(() => true));
  }, 60_000);

  it("checks a server from the address step, and shows the check's refusal on that step with the address kept", async () => {
    const page = await (await fetch(`${address}/outside-parties/add?fleet=${FLEET}`, { headers: PAGE })).text();
    const form = hiddenFieldsOf(page, 'add-server-address');
    form.append('url', 'http://127.0.0.1:9/mcp');
    form.append('credentialKind', 'bearer');
    form.append('token', 'a-token');

    const answer = await (await fetch(`${address}/outside-parties/add?fleet=${FLEET}`, { method: 'POST', headers: { ...PAGE, origin: address }, body: form })).text();

    expect({ isRefused: answer.includes('role="alert"'), isAddressKept: answer.includes('value="http://127.0.0.1:9/mcp"') }).toEqual({ isRefused: true, isAddressKept: true });
  }, 60_000);

  it('offers No credential for a server on the add page and the Parties page (aeolus-fleet#1153)', async () => {
    const bodies = await Promise.all(['/outside-parties/add', '/parties'].map(async (path) => (await fetch(`${address}${path}?fleet=${FLEET}`, { headers: PAGE })).text()));

    expect(bodies.map((body) => /<option value="none"[^>]*>No credential<\/option>/.test(body))).toEqual([true, true]);
  }, 60_000);

  it('shows the Parties page with the form that approves a server to an account holding fleet:manage, and not to one that only reads', async () => {
    const bodies = await Promise.all(
      [SIGN_IN, READER_SIGN_IN].map(async (signIn) => (await fetch(`${address}/parties?fleet=${FLEET}`, { headers: { accept: 'text/html', cookie: `aeolus_account_session=${signIn}` } })).text()),
    );

    expect(bodies.map((body) => ({ hasNoParty: textOf(body).includes('No party yet.'), hasApprove: body.includes('data-testid="parties-approve"') }))).toEqual([
      { hasNoParty: true, hasApprove: true },
      { hasNoParty: true, hasApprove: false },
    ]);
  }, 60_000);

  it("has the owner of a server it approves picked from the fleet's owner choices, never typed as an id (aeolus-fleet#1092)", async () => {
    const body = await (await fetch(`${address}/parties?fleet=${FLEET}`, { headers: PAGE })).text();

    const approve = body.slice(body.indexOf('data-testid="parties-approve"'));
    expect({ isPicked: approve.includes('data-testid="owner-field"'), isTyped: /<input[^>]*name="ownerShipId"/.test(approve) }).toEqual({ isPicked: true, isTyped: false });
  }, 60_000);

  it('shows Add A2A client to an account holding gateway:approve, and not to one that only reads (decision 0060)', async () => {
    const bodies = await Promise.all(
      [APPROVER_SIGN_IN, READER_SIGN_IN].map(async (signIn) => (await fetch(`${address}/outside-parties?fleet=${FLEET}`, { headers: { accept: 'text/html', cookie: `aeolus_account_session=${signIn}` } })).text()),
    );

    expect(bodies.map((body) => body.includes('data-testid="outside-parties-add-a2a-client"'))).toEqual([true, false]);
  }, 60_000);

  it("adds an A2A client from its page: its name, its owner picked from the fleet's owner choices, and the approver's own scopes to tick", async () => {
    const body = await (await fetch(`${address}/outside-parties/add-a2a-client?fleet=${FLEET}`, { headers: { accept: 'text/html', cookie: `aeolus_account_session=${APPROVER_SIGN_IN}` } })).text();

    const form = body.slice(body.indexOf('data-testid="add-a2a-client-form"'));
    expect({ hasForm: body.includes('data-testid="add-a2a-client-form"'), hasOwner: form.includes('data-testid="owner-field"'), hasScope: form.includes('name="scope:fleet:read"'), hasOwnScopeOnly: !form.includes('name="scope:fleet:manage"') }).toEqual({
      hasForm: true,
      hasOwner: true,
      hasScope: true,
      hasOwnScopeOnly: true,
    });
  }, 60_000);

  it('shows Add A2A agent to an account holding gateway:approve, and not to one that only reads (slice 5)', async () => {
    const bodies = await Promise.all(
      [APPROVER_SIGN_IN, READER_SIGN_IN].map(async (signIn) => (await fetch(`${address}/outside-parties?fleet=${FLEET}`, { headers: { accept: 'text/html', cookie: `aeolus_account_session=${signIn}` } })).text()),
    );

    expect(bodies.map((body) => body.includes('data-testid="outside-parties-add-a2a-agent"'))).toEqual([true, false]);
  }, 60_000);

  it("adds an A2A agent from its page: its name, card address, credential, calls at once, its owner picked from the fleet's owner choices, and the approver's own scopes", async () => {
    const body = await (await fetch(`${address}/outside-parties/add-a2a-agent?fleet=${FLEET}`, { headers: { accept: 'text/html', cookie: `aeolus_account_session=${APPROVER_SIGN_IN}` } })).text();

    const form = body.slice(body.indexOf('data-testid="add-a2a-agent-form"'));
    expect({
      hasForm: body.includes('data-testid="add-a2a-agent-form"'),
      hasCardUrl: form.includes('name="cardUrl"'),
      offersNoCredential: textOf(form).includes('No credential'),
      hasConcurrency: form.includes('name="concurrencyLimit"'),
      hasOwner: form.includes('data-testid="owner-field"'),
      hasOwnScopeOnly: form.includes('name="scope:fleet:read"') && !form.includes('name="scope:fleet:manage"'),
    }).toEqual({ hasForm: true, hasCardUrl: true, offersNoCredential: true, hasConcurrency: true, hasOwner: true, hasOwnScopeOnly: true });
  }, 60_000);

  it('shows the header every Aeolus app shows: the fleet in view and Gateway in the title, and the avatar menu', async () => {
    const body = await (await fetch(`${address}/parties?fleet=${FLEET}`, { headers: PAGE })).text();

    expect(body).toContain('aria-label="Fleet: Acme. Switch fleet"');
    expect(body).toContain('aria-label="App: Gateway. Switch app"');
    expect(body).toContain('data-testid="avatar-menu"');
  });

  it("links the overview, the outside parties and the parties of the fleet in view from the header, the page shown current (aeolus-fleet#1120, #1119)", async () => {
    const bodies = await Promise.all(['/overview', '/outside-parties', '/parties'].map(async (page) => (await fetch(`${address}${page}?fleet=${FLEET}`, { headers: PAGE })).text()));

    // The desktop header and the phone bar each show the tabs: each tab is read once.
    const tabsOf = (body: string) => [...new Set([...body.matchAll(/<a[^>]*data-testid="frame-tab-[^"]*"[^>]*>/g)].map(([tab]) => tab))].map((tab) => ({ href: /href="([^"]*)"/.exec(tab)?.[1], isCurrent: tab.includes('aria-current="page"') }));

    expect(bodies.map(tabsOf)).toEqual([
      [
        { href: `/overview?fleet=${FLEET}`, isCurrent: true },
        { href: `/outside-parties?fleet=${FLEET}`, isCurrent: false },
        { href: `/parties?fleet=${FLEET}`, isCurrent: false },
      ],
      [
        { href: `/overview?fleet=${FLEET}`, isCurrent: false },
        { href: `/outside-parties?fleet=${FLEET}`, isCurrent: true },
        { href: `/parties?fleet=${FLEET}`, isCurrent: false },
      ],
      [
        { href: `/overview?fleet=${FLEET}`, isCurrent: false },
        { href: `/outside-parties?fleet=${FLEET}`, isCurrent: false },
        { href: `/parties?fleet=${FLEET}`, isCurrent: true },
      ],
    ]);
  }, 60_000);

  it("shows the fleet the address names in the header's title, when it is not the first fleet the account may open", async () => {
    const body = await (await fetch(`${address}/parties?fleet=${FLEET}`, { headers: { accept: 'text/html', cookie: `aeolus_account_session=${SECOND_FLEET_SIGN_IN}` } })).text();

    expect(body).toContain('aria-label="Fleet: Acme. Switch fleet"');
  }, 60_000);

  it('shows the plain bar when pagasae does not answer the apps and fleets the account may open', async () => {
    const body = await (await fetch(`${address}/parties?fleet=${FLEET}`, { headers: { accept: 'text/html', cookie: `aeolus_account_session=${UNLISTED_SIGN_IN}` } })).text();

    expect({ isPlain: body.includes('data-testid="plain-header"'), hasAvatarMenu: body.includes('data-testid="avatar-menu"') }).toEqual({ isPlain: true, hasAvatarMenu: false });
  }, 60_000);

  it('shows the plain bar to a browser signed in to no account', async () => {
    const body = await (await fetch(`${address}/sign-in/failed`, { headers: { accept: 'text/html' } })).text();

    expect({ isPlain: body.includes('data-testid="plain-header"'), hasAvatarMenu: body.includes('data-testid="avatar-menu"') }).toEqual({ isPlain: true, hasAvatarMenu: false });
  }, 60_000);

  it('sends a page that names no fleet to the same page in the fleet the account may open', async () => {
    const page = await fetch(`${address}/parties`, { headers: PAGE, redirect: 'manual' });

    expect(page.headers.get('location')).toBe(`/parties?fleet=${FLEET}`);
  }, 60_000);

  it('sends a browser signed in to no account to sign in, and back to the page', async () => {
    const page = await fetch(`${address}/outside-parties/add?fleet=${FLEET}`, { headers: { accept: 'text/html' }, redirect: 'manual' });

    expect(page.headers.get('location')).toBe(`/sign-in/start?return_to=${encodeURIComponent(`/outside-parties/add?fleet=${FLEET}`)}`);
  }, 60_000);
});
