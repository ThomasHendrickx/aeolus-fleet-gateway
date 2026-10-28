import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aSlackApp, aSlackWorkspace, fakeSlackSignIn, memorySlackApps, memorySlackWorkspaces, plainLinkStates } from '../../../test/support/slack-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import type { PersonCaller } from '../people/person-crew.js';
import { err, ok } from '../shared/result.js';
import { createStartLink } from './start-link.js';

// Link Slack, from the Overview or the button in Slack's answer (gateway
// scopes 9.3): Sign in with Slack through the fleet's own bot's app, for
// the fleet's workspace, the link's state sealed for ten minutes. Only an
// account with a person ship in the fleet links; its person ship is crewed
// now, so its messages from Slack can be sent as it.

const NOW = new Date('2026-10-27T09:00:00.000Z');
const LINK_REDIRECT_URL = 'https://gateway.acme.test/gw/slack/link';
const MATHILDE: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc-mathilde', personShipId: 'shp_01m3tbfspe96yf1rnr4ank9m4t', accountToken: 'account-token-1', scopes: [] };

let workspaces: ReturnType<typeof memorySlackWorkspaces>;
let apps: ReturnType<typeof memorySlackApps>;
let crewed: PersonCaller[];
let isCrewRefused: boolean;

beforeEach(async () => {
  workspaces = memorySlackWorkspaces();
  apps = memorySlackApps();
  crewed = [];
  isCrewRefused = false;
  await workspaces.save(aSlackWorkspace());
  await apps.save(aSlackApp());
});

function startLink(actor: Actor = MATHILDE) {
  return createStartLink({
    workspaces,
    apps,
    signIn: fakeSlackSignIn().signIn,
    states: plainLinkStates(),
    crewPersonShip: (caller) => {
      if (isCrewRefused) {
        return Promise.resolve(err({ kind: 'fleetRefused' as const, message: 'The fleet did not answer' }));
      }
      crewed.push(caller);
      return Promise.resolve(ok({ shipId: 'shp_01m3tbfspe96yf1rnr4ank9m4t' as const, crewToken: 'crew-mathilde' }));
    },
    clock: { now: () => NOW },
    linkRedirectUrl: LINK_REDIRECT_URL,
  })({ actor });
}

describe('starting a Slack link', () => {
  it("opens Sign in with Slack through the fleet's own bot, for its workspace, with the link's state sealed for ten minutes", async () => {
    const started = await startLink();

    const url = new URL(started.isOk ? started.value.url : '');
    expect(url.searchParams.get('client_id')).toBe('client-A01');
    expect(url.searchParams.get('team')).toBe('T0ACME');
    expect(url.searchParams.get('redirect_uri')).toBe(LINK_REDIRECT_URL);
    expect(url.searchParams.get('state')).toBe(JSON.stringify({ fleetId: FLEET_ID, accountId: 'acc-mathilde', personShipId: 'shp_01m3tbfspe96yf1rnr4ank9m4t', expiresAt: new Date('2026-10-27T09:10:00.000Z') }));
  });

  it("crews the account's person ship, so its messages from Slack can be sent as it", async () => {
    await startLink();

    expect(crewed).toEqual([{ fleetId: FLEET_ID, signedIn: { accountToken: 'account-token-1', personShipId: 'shp_01m3tbfspe96yf1rnr4ank9m4t' } }]);
  });

  it('refuses an account with no person ship in this fleet', async () => {
    const started = await startLink({ ...MATHILDE, personShipId: null });

    expect(started).toEqual(err({ kind: 'NOT_A_PERSON', message: 'Your account has no person ship in this fleet' }));
  });

  it('refuses a ship, which has no Slack account to link', async () => {
    const started = await startLink({ fleetId: FLEET_ID, kind: 'ship', shipId: 'shp_01m3tbfspe96yf1rnr4ank9r1n', scopes: [] });

    expect(started).toEqual(err({ kind: 'NOT_A_PERSON', message: 'Your account has no person ship in this fleet' }));
  });

  it('refuses while the fleet is connected to no Slack workspace', async () => {
    await workspaces.remove(FLEET_ID);

    const started = await startLink();

    expect(started.isOk ? undefined : started.error.kind).toBe('SLACK_NOT_CONNECTED');
  });

  it("refuses while the fleet's own bot is not made", async () => {
    await apps.remove(FLEET_ID, 'A01');

    const started = await startLink();

    expect(started.isOk ? undefined : started.error.kind).toBe('NO_SUCH_BOT');
  });

  it('refuses when the fleet does not crew the person ship, saying why', async () => {
    isCrewRefused = true;

    const started = await startLink();

    expect(started).toEqual(err({ kind: 'FLEET_UNAVAILABLE', message: 'The fleet did not crew your person ship: The fleet did not answer' }));
  });
});
