import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aSlackApp, aSlackLink, aSlackWorkspace, fakeShipNames, fakeSlackSignIn, memorySlackApps, memorySlackLinks, memorySlackWorkspaces, plainLinkStates } from '../../../test/support/slack-fakes.js';
import type { SharedAccountToken } from '../account-sign-in/ports.js';
import { err, ok } from '../shared/result.js';
import { createCompleteLink } from './complete-link.js';

// Sign in with Slack sends the person back with a code and the link's state
// (gateway scopes 9.3). The link is kept by fleet, Slack workspace and user,
// and person ship. One Slack user links to one account per fleet: a second
// link is refused, naming the first.

const NOW = new Date('2026-10-27T09:05:00.000Z');
const LINK_REDIRECT_URL = 'https://gateway.acme.test/gw/slack/link';
const MATHILDE_SHIP = 'shp_01m3tbfspe96yf1rnr4ank9m4t';
const JORIS_SHIP = 'shp_01m3tbfspe96yf1rnr4ank9j0r';
const states = plainLinkStates();
const STATE = states.seal({ fleetId: FLEET_ID, accountId: 'acc-mathilde', personShipId: MATHILDE_SHIP, expiresAt: new Date('2026-10-27T09:10:00.000Z') });

/** The shared sign-ins the browsers hold, by the account each names. */
const SIGNED_IN: Readonly<Record<string, string>> = { 'sign-in-mathilde': 'acc-mathilde', 'sign-in-joris': 'acc-joris' };

function accountOf({ signIn }: { signIn: string }) {
  const accountId = SIGNED_IN[signIn];
  return Promise.resolve(
    accountId === undefined
      ? err({ kind: 'signedOut' as const })
      : ok<SharedAccountToken>({ accountToken: `token-${accountId}`, endsAt: new Date('2026-10-27T10:00:00.000Z'), accountId, personShipId: null, scopes: [] }),
  );
}

let workspaces: ReturnType<typeof memorySlackWorkspaces>;
let apps: ReturnType<typeof memorySlackApps>;
let links: ReturnType<typeof memorySlackLinks>;
let slack: ReturnType<typeof fakeSlackSignIn>;

beforeEach(async () => {
  workspaces = memorySlackWorkspaces();
  apps = memorySlackApps();
  links = memorySlackLinks();
  slack = fakeSlackSignIn();
  slack.state.codes.set('code-mathilde', { teamId: 'T0ACME', userId: 'U0MATHILDE', name: 'mathilde' });
  await workspaces.save(aSlackWorkspace({ teamName: 'Acme' }));
  await apps.save(aSlackApp());
});

function completeLink(input: { code: string; state: string; signIn: string | undefined } = { code: 'code-mathilde', state: STATE, signIn: 'sign-in-mathilde' }, now = NOW) {
  return createCompleteLink({
    workspaces,
    apps,
    links,
    signIn: slack.signIn,
    states,
    accountOf,
    shipNames: fakeShipNames({ [JORIS_SHIP]: 'joris' }),
    clock: { now: () => now },
    linkRedirectUrl: LINK_REDIRECT_URL,
  })(input);
}

describe('completing a Slack link', () => {
  it('keeps the link by fleet, Slack workspace and user, and person ship', async () => {
    const completed = await completeLink();

    expect(completed).toEqual(ok({ fleetId: FLEET_ID }));
    expect(links.held).toEqual([aSlackLink({ linkedAt: NOW })]);
    expect(slack.state.signIns).toEqual([{ clientId: 'client-A01', code: 'code-mathilde', redirectUrl: LINK_REDIRECT_URL }]);
  });

  it('refuses a second link of the Slack user, naming the first', async () => {
    await links.add(aSlackLink({ accountId: 'acc-joris', personShipId: JORIS_SHIP }));

    const completed = await completeLink();

    expect(completed).toEqual(err({ kind: 'SLACK_USER_LINKED', message: 'This Slack account is linked to joris in this fleet already', fleetId: FLEET_ID, name: 'joris' }));
    expect(links.held.map(({ accountId }) => accountId)).toEqual(['acc-joris']);
  });

  it('links the same Slack user to the same account again, the link stopped no more', async () => {
    await links.add(aSlackLink({ stoppedAt: new Date('2026-10-27T08:50:00.000Z') }));

    const completed = await completeLink();

    expect(completed.isOk).toBe(true);
    expect(links.held).toEqual([aSlackLink({ linkedAt: NOW })]);
  });

  it('refuses a link of an account linked to another Slack user, until it is unlinked', async () => {
    await links.add(aSlackLink({ slackUserId: 'U0OTHER', slackName: 'mathilde.old' }));

    const completed = await completeLink();

    expect(completed).toEqual(err({ kind: 'ACCOUNT_LINKED', message: 'Your account is linked to Slack as @mathilde.old already: unlink it on the Overview first', fleetId: FLEET_ID, name: 'mathilde.old' }));
  });

  it("refuses a Slack user of another workspace than the fleet's", async () => {
    slack.state.codes.set('code-mathilde', { teamId: 'T0OTHER', userId: 'U0MATHILDE', name: 'mathilde' });

    const completed = await completeLink();

    expect(completed).toEqual(err({ kind: 'OTHER_WORKSPACE', message: 'The fleet is connected to Acme: sign in with Slack there' }));
    expect(links.held).toEqual([]);
  });

  it('refuses a link the gateway did not start, keeping nothing', async () => {
    const completed = await completeLink({ code: 'code-mathilde', state: 'forged', signIn: 'sign-in-mathilde' });

    expect(completed.isOk ? undefined : completed.error.kind).toBe('LINK_REFUSED');
    expect(slack.state.signIns).toEqual([]);
  });

  it('refuses a link followed in a browser signed in as another account, keeping nothing and asking Slack nothing', async () => {
    const completed = await completeLink({ code: 'code-mathilde', state: STATE, signIn: 'sign-in-joris' });

    expect(completed).toEqual(err({ kind: 'LINK_REFUSED', message: 'This link was started by another account or browser: sign in and press Link Slack again' }));
    expect({ links: links.held, signIns: slack.state.signIns }).toEqual({ links: [], signIns: [] });
  });

  it('refuses a link followed in a browser signed in to no account, keeping nothing and asking Slack nothing', async () => {
    const completed = await completeLink({ code: 'code-mathilde', state: STATE, signIn: undefined });

    expect(completed).toEqual(err({ kind: 'LINK_REFUSED', message: 'This link was started by another account or browser: sign in and press Link Slack again' }));
    expect({ links: links.held, signIns: slack.state.signIns }).toEqual({ links: [], signIns: [] });
  });

  it('refuses a link followed in a browser whose sign-in the fleet no longer takes, keeping nothing', async () => {
    const completed = await completeLink({ code: 'code-mathilde', state: STATE, signIn: 'sign-in-ended' });

    expect(completed.isOk ? undefined : completed.error.kind).toBe('LINK_REFUSED');
    expect(links.held).toEqual([]);
  });

  it('refuses a link that took longer than ten minutes, at the boundary refused', async () => {
    const completed = await completeLink(undefined, new Date('2026-10-27T09:10:00.000Z'));

    expect(completed.isOk ? undefined : completed.error.kind).toBe('LINK_REFUSED');
  });

  it('takes a link one millisecond within its ten minutes', async () => {
    const completed = await completeLink(undefined, new Date('2026-10-27T09:09:59.999Z'));

    expect(completed.isOk).toBe(true);
  });

  it('refuses when Slack refuses the code, keeping nothing', async () => {
    const completed = await completeLink({ code: 'code-unknown', state: STATE, signIn: 'sign-in-mathilde' });

    expect(completed).toEqual(err({ kind: 'LINK_REFUSED', message: 'Slack refused the sign-in (invalid_code): press Link Slack again' }));
    expect(links.held).toEqual([]);
  });

  it('says Slack did not answer, keeping nothing', async () => {
    slack.state.refusal = { kind: 'unavailable', message: 'timeout' };

    const completed = await completeLink();

    expect(completed.isOk ? undefined : completed.error.kind).toBe('SLACK_UNAVAILABLE');
    expect(links.held).toEqual([]);
  });
});
