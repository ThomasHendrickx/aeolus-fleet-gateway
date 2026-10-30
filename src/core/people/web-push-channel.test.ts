import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aWebPushSubscription, fakeWebPush, memoryWebPushSubscriptions } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { err, ok } from '../shared/result.js';
import { createWebPushChannel } from './web-push-channel.js';

// Web push, a channel that wakes a person (wake a person, W1, W4, W8): on
// while they turned it on in a browser, it sends each such browser a wake
// that says only the fleet by its name and the overview link.

const SHIP = { fleetId: FLEET_ID, shipId: PERSON_SHIP_ID };
const NOW = new Date('2026-10-23T10:00:00.000Z');
const WINDOW_MS = 10 * 60 * 1000;
const OVERVIEW_URL = `https://gateway.example/overview?fleet=${FLEET_ID}`;

let subscriptions: ReturnType<typeof memoryWebPushSubscriptions>;
let push: ReturnType<typeof fakeWebPush>;

beforeEach(() => {
  subscriptions = memoryWebPushSubscriptions();
  push = fakeWebPush();
});

function webPushChannel() {
  return createWebPushChannel({ subscriptions, webPush: push.webPush, clock: { now: () => NOW }, windowMs: WINDOW_MS, overviewUrlOf: (fleetId) => `https://gateway.example/overview?fleet=${fleetId}` });
}

describe('the web push channel', () => {
  it("is named web-push, with its window from the gateway's configuration", () => {
    expect({ name: webPushChannel().name, windowMs: webPushChannel().windowMs }).toEqual({ name: 'web-push', windowMs: WINDOW_MS });
  });

  it('is off until the person turned it on in a browser: nothing is on by default', async () => {
    await expect(webPushChannel().isOn(SHIP)).resolves.toBe(false);
  });

  it('is on while a browser of theirs takes wakes, and off once every one is gone', async () => {
    await subscriptions.save(aWebPushSubscription());
    const isOnWhileTaken = await webPushChannel().isOn(SHIP);
    await subscriptions.markGone(FLEET_ID, { shipId: PERSON_SHIP_ID, endpoint: aWebPushSubscription().endpoint, goneAt: NOW });

    expect({ isOnWhileTaken, isOnOnceGone: await webPushChannel().isOn(SHIP) }).toEqual({ isOnWhileTaken: true, isOnOnceGone: false });
  });

  it("is off for another person's browser", async () => {
    await subscriptions.save(aWebPushSubscription({ shipId: 'shp_01m3tb1zgr5h2ffee12xnch8zz' }));

    await expect(webPushChannel().isOn(SHIP)).resolves.toBe(false);
  });

  it('wakes each browser they turned on: the fleet by its name and the overview link, nothing else', async () => {
    await subscriptions.save(aWebPushSubscription({ endpoint: 'https://push.example/firefox' }));
    await subscriptions.save(aWebPushSubscription({ endpoint: 'https://push.example/chrome', browser: 'Chrome on macOS' }));

    await expect(webPushChannel().wake(SHIP, { key: 'window-1' })).resolves.toEqual(ok(undefined));

    expect(push.sent).toEqual([
      { endpoint: 'https://push.example/firefox', wake: { fleetName: 'Acme', overviewUrl: OVERVIEW_URL } },
      { endpoint: 'https://push.example/chrome', wake: { fleetName: 'Acme', overviewUrl: OVERVIEW_URL } },
    ]);
  });

  it('went out once one browser took it, though another failed', async () => {
    await subscriptions.save(aWebPushSubscription({ endpoint: 'https://push.example/firefox' }));
    await subscriptions.save(aWebPushSubscription({ endpoint: 'https://push.example/chrome' }));
    push.answers.set('https://push.example/firefox', ['failed']);

    await expect(webPushChannel().wake(SHIP, { key: 'window-1' })).resolves.toEqual(ok(undefined));
  });

  it('did not go out when every push service failed, to be tried again', async () => {
    await subscriptions.save(aWebPushSubscription());
    push.answers.set(aWebPushSubscription().endpoint, ['failed']);

    await expect(webPushChannel().wake(SHIP, { key: 'window-1' })).resolves.toEqual(err({ kind: 'unavailable', reason: 'no push service took the wake' }));
  });

  it('forgets a subscription its push service says is gone, keeping it shown as gone, and sends it nothing again', async () => {
    await subscriptions.save(aWebPushSubscription());
    push.answers.set(aWebPushSubscription().endpoint, ['gone']);

    const woken = await webPushChannel().wake(SHIP, { key: 'window-1' });
    await webPushChannel().wake(SHIP, { key: 'window-1' });

    expect({ woken, held: subscriptions.held, sent: push.sent }).toEqual({ woken: err({ kind: 'unavailable', reason: 'no push service took the wake' }), held: [aWebPushSubscription({ goneAt: NOW })], sent: [] });
  });
});
