import { beforeEach, describe, expect, it } from 'vitest';

import { aSlackApp, memorySlackApps } from '../../../test/support/slack-fakes.js';
import { createTakeSlackEvent } from './take-slack-event.js';

// Slack signs each event with the app's signing secret (gateway scopes 9.4
// step 1): the gateway takes only an event signed so, within 5 minutes of
// its timestamp. An app uninstalled or its tokens revoked shows Removed in
// Slack (9.2).

const NOW = new Date('2026-10-27T09:00:00.000Z');
const NOW_SECONDS = String(NOW.getTime() / 1000);
const RELEASE_NOTES = 'shp_01m3tbfspe96yf1rnr4ank9r1n';

let apps: ReturnType<typeof memorySlackApps>;

beforeEach(async () => {
  apps = memorySlackApps();
  await apps.save(aSlackApp({ appId: 'A02', shipId: RELEASE_NOTES, name: 'release-notes', bot: { token: 'xoxb-2', userId: 'U02' } }));
});

/** Signs as a test: the signature is the secret, the timestamp and the body joined. */
const signatures = { isSigned: ({ secret, timestamp, body, signature }: { secret: string; timestamp: string; body: string; signature: string }) => signature === `${secret}:${timestamp}:${body}` };

function takeEvent(event: { type: string; timestamp?: string; signature?: string; appId?: string }) {
  const timestamp = event.timestamp ?? NOW_SECONDS;
  const body = JSON.stringify({ api_app_id: event.appId ?? 'A02', event: { type: event.type } });
  return createTakeSlackEvent({ apps, signatures, clock: { now: () => NOW } })({
    appId: event.appId ?? 'A02',
    eventType: event.type,
    body,
    timestamp,
    signature: event.signature ?? `signing-A02:${timestamp}:${body}`,
  });
}

describe('an event Slack sends the gateway', () => {
  it("marks the app Removed in Slack when it is uninstalled, forgetting its bot token", async () => {
    await expect(takeEvent({ type: 'app_uninstalled' })).resolves.toEqual({ isOk: true, value: { kind: 'taken' } });
    expect(apps.held[0]).toMatchObject({ removedInSlackAt: NOW, bot: null });
  });

  it('marks it Removed in Slack when its tokens are revoked', async () => {
    await takeEvent({ type: 'tokens_revoked' });

    expect(apps.held[0]?.removedInSlackAt).toEqual(NOW);
  });

  it('refuses an event not signed with the app\'s signing secret, changing nothing', async () => {
    await expect(takeEvent({ type: 'app_uninstalled', signature: 'v0=forged' })).resolves.toEqual({ isOk: false, error: { kind: 'notSigned' } });
    expect(apps.held[0]?.removedInSlackAt).toBeNull();
  });

  it('refuses an event whose timestamp is more than 5 minutes off, at the boundary taken', async () => {
    const fiveMinutesAgo = String(NOW.getTime() / 1000 - 300);
    const moreThanFive = String(NOW.getTime() / 1000 - 301);

    await expect(takeEvent({ type: 'tokens_revoked', timestamp: moreThanFive })).resolves.toEqual({ isOk: false, error: { kind: 'notSigned' } });
    await expect(takeEvent({ type: 'tokens_revoked', timestamp: fiveMinutesAgo })).resolves.toMatchObject({ isOk: true });
  });

  it('refuses an event for an app the gateway did not make', async () => {
    await expect(takeEvent({ type: 'app_uninstalled', appId: 'A99' })).resolves.toEqual({ isOk: false, error: { kind: 'notSigned' } });
  });

  it('takes an event it does not act on yet, changing nothing', async () => {
    await expect(takeEvent({ type: 'app_mention' })).resolves.toEqual({ isOk: true, value: { kind: 'ignored' } });
    expect(apps.held[0]?.removedInSlackAt).toBeNull();
  });
});
