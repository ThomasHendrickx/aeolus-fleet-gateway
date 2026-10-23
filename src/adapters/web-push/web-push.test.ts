import { generateVAPIDKeys } from 'web-push';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { aWebPushSubscription } from '../../../test/support/people-fakes.js';
import { startPushService } from '../../../test/support/push-service.js';
import { createWebPush } from './web-push.js';

// The gateway's web push: a wake to one browser through its push service,
// encrypted for that browser and signed with the gateway's push keys (VAPID).

const WAKE = { fleetName: 'Acme', overviewUrl: 'https://gateway.example/overview?fleet=flt_01m3tb1zgr5h2ffee12xnch8sv' };
const keys = generateVAPIDKeys();

let service: Awaited<ReturnType<typeof startPushService>>;

beforeEach(async () => {
  service = await startPushService();
});

afterEach(async () => {
  await service.stop();
});

function webPush() {
  return createWebPush({ publicKey: keys.publicKey, privateKey: keys.privateKey, subject: 'mailto:gateway@example.com', timeoutMs: 2000 });
}

function subscriptionOf(path: string) {
  const browser = service.browser(path);
  return aWebPushSubscription({ endpoint: browser.endpoint, keys: browser.keys });
}

describe('a wake sent to a browser through its push service', () => {
  it('says only the fleet by its name and the overview link, as the browser reads it', async () => {
    const sent = await webPush().send(subscriptionOf('/firefox'), WAKE);

    expect({ sent, read: service.taken.map(({ text }) => JSON.parse(text) as unknown) }).toEqual({ sent: 'sent', read: [WAKE] });
  });

  it("is signed with the gateway's push keys", async () => {
    await webPush().send(subscriptionOf('/firefox'), WAKE);

    expect(service.taken[0]?.headers.authorization).toMatch(new RegExp(`^vapid t=.+, k=${keys.publicKey}$`));
  });

  it.each([404, 410])('finds the subscription gone when its push service answers %i', async (status) => {
    service.statuses.set('/gone', [status]);

    await expect(webPush().send(subscriptionOf('/gone'), WAKE)).resolves.toBe('gone');
  });

  it.each([400, 429, 500])('failed when its push service answers %i', async (status) => {
    service.statuses.set('/failing', [status]);

    await expect(webPush().send(subscriptionOf('/failing'), WAKE)).resolves.toBe('failed');
  });

  it('failed when its push service does not answer', async () => {
    await service.stop();

    await expect(webPush().send(subscriptionOf('/away'), WAKE)).resolves.toBe('failed');
  });
});
