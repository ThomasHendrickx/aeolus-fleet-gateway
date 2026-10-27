import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startFakeSlack, type FakeSlack } from '../../../test/support/fake-slack.js';
import { gatewayBotDescription } from '../../core/slack/slack-app.js';
import { createSlackSignIn } from './slack-sign-in.js';
import { createSlackTooling } from './slack-tooling.js';

// Sign in with Slack (OpenID Connect) through the fleet's own bot's app
// (gateway scopes 9.3), against the Slack double: its sign-in screen sends
// the person back with a code, which names the Slack workspace and user.

const LINK_REDIRECT_URL = 'https://gateway.acme.test/gw/slack/link';

let slack: FakeSlack;

beforeEach(async () => {
  slack = await startFakeSlack();
  slack.issueRefreshToken('xoxe-1-first');
  const tooling = createSlackTooling({ apiUrl: slack.apiUrl });
  const rotated = await tooling.rotateConfigurationToken('xoxe-1-first');
  await tooling.makeApp(rotated.isOk ? rotated.value.token.accessToken : '', gatewayBotDescription('Acme', { installRedirectUrl: 'https://gateway.acme.test/gw/slack/install', linkRedirectUrl: LINK_REDIRECT_URL }));
});

afterEach(async () => {
  await slack.stop();
});

async function codeFrom(url: string): Promise<string> {
  const back = await fetch(url, { redirect: 'manual' });
  return new URL(back.headers.get('location') ?? '').searchParams.get('code') ?? '';
}

describe('Sign in with Slack', () => {
  it("opens Slack's sign-in for the app and workspace, and turns its code into who signed in", async () => {
    const signIn = createSlackSignIn({ apiUrl: slack.apiUrl });
    slack.signInAs({ userId: 'U0MATHILDE', name: 'Mathilde Peeters' });
    const url = signIn.authorizeUrl({ clientId: 'client-A01', redirectUrl: LINK_REDIRECT_URL, state: 'sealed', teamId: 'T0ACME' });

    const signedIn = await signIn.complete({ clientId: 'client-A01', clientSecret: 'secret-A01', code: await codeFrom(url), redirectUrl: LINK_REDIRECT_URL });

    expect(new URL(url).searchParams.get('team')).toBe('T0ACME');
    expect(signedIn).toEqual({ isOk: true, value: { teamId: 'T0ACME', userId: 'U0MATHILDE', name: 'Mathilde Peeters' } });
  });

  it("answers Slack's own error code for a code it does not take", async () => {
    await expect(createSlackSignIn({ apiUrl: slack.apiUrl }).complete({ clientId: 'client-A01', clientSecret: 'secret-A01', code: 'spent', redirectUrl: LINK_REDIRECT_URL })).resolves.toEqual({ isOk: false, error: { kind: 'refused', error: 'invalid_code' } });
  });
});
