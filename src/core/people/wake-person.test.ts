import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import {
  aPersonDelivery,
  aWebPushSubscription,
  fakePersonShipDoor,
  fakeWebPush,
  memoryFocusedPages,
  memoryPersonWakes,
  memoryWebPushSubscriptions,
} from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import type { PersonDelivery } from './ports.js';
import { createWakePerson } from './wake-person.js';

// The gateway wakes a person when something waits for their person ship
// (wake a person, W3, W4, W6, W8, W10): through the web push they turned on,
// at most once per window, unless one of their pages is in focus, and each
// delivery the wake covers is reported handed, naming its channel.

const SHIP = { fleetId: FLEET_ID, shipId: PERSON_SHIP_ID };
const CREW_TOKEN = 'aeolus_ct_v1_charlotte';
const NOW = new Date('2026-10-23T10:00:00.000Z');
const WINDOW_MS = 10 * 60 * 1000;
const FOCUS_FRESH_MS = 60 * 1000;
const OVERVIEW_URL = `https://gateway.example/overview?fleet=${FLEET_ID}`;

/** The nth delivery to Charlotte's person ship. */
function delivery(n: number, overrides: Partial<PersonDelivery> = {}): PersonDelivery {
  const id = String(n).padStart(4, '0');
  return aPersonDelivery({ deliveryId: `dlv_01m3tbfspe96yf1rnr4ank${id}`, messageId: `msg_01m3tbfspe96yf1rnr4ank${id}`, ...overrides });
}

let subscriptions: ReturnType<typeof memoryWebPushSubscriptions>;
let wakes: ReturnType<typeof memoryPersonWakes>;
let focused: ReturnType<typeof memoryFocusedPages>;
let push: ReturnType<typeof fakeWebPush>;
let now: Date;

beforeEach(() => {
  subscriptions = memoryWebPushSubscriptions();
  wakes = memoryPersonWakes();
  focused = memoryFocusedPages();
  push = fakeWebPush();
  now = NOW;
});

function waking(deliveries: PersonDelivery[], options: { hasPushKeys?: boolean } = {}) {
  const ship = fakePersonShipDoor({ crewToken: CREW_TOKEN, deliveries });
  const wakePerson = createWakePerson({
    door: ship.door,
    subscriptions,
    wakes,
    focused,
    ...(options.hasPushKeys === false ? {} : { webPush: push.webPush }),
    clock: { now: () => now },
    windowMs: { webPush: WINDOW_MS },
    focusFreshMs: FOCUS_FRESH_MS,
    overviewUrlOf: (fleetId) => `https://gateway.example/overview?fleet=${fleetId}`,
  });
  return { ...ship, wake: () => wakePerson(SHIP, CREW_TOKEN) };
}

const handedCalls = (calls: string[]) => calls.filter((call) => call.startsWith('handed'));

describe('a person is woken when something waits for their person ship', () => {
  it('is not woken while they turned no channel on, and nothing is handed: it stays received for their next look', async () => {
    const { wake, calls } = waking([delivery(1)]);

    await expect(wake()).resolves.toEqual({ kind: 'settled' });

    expect(push.sent).toEqual([]);
    expect(handedCalls(calls)).toEqual([]);
  });

  it('is not woken through web push while the gateway holds no push keys, and nothing is handed', async () => {
    await subscriptions.save(aWebPushSubscription());
    const { wake, calls } = waking([delivery(1)], { hasPushKeys: false });

    await expect(wake()).resolves.toEqual({ kind: 'settled' });

    expect(push.sent).toEqual([]);
    expect(handedCalls(calls)).toEqual([]);
  });

  it('through web push in each browser they turned on: the fleet by its name and the overview link, nothing else', async () => {
    await subscriptions.save(aWebPushSubscription({ endpoint: 'https://push.example/firefox' }));
    await subscriptions.save(aWebPushSubscription({ endpoint: 'https://push.example/chrome', browser: 'Chrome on macOS' }));
    const { wake } = waking([delivery(1)]);

    await wake();

    expect(push.sent).toEqual([
      { endpoint: 'https://push.example/firefox', wake: { fleetName: 'Acme', overviewUrl: OVERVIEW_URL } },
      { endpoint: 'https://push.example/chrome', wake: { fleetName: 'Acme', overviewUrl: OVERVIEW_URL } },
    ]);
  });

  it('reports each delivery the wake covers handed, number 1, through web push', async () => {
    await subscriptions.save(aWebPushSubscription());
    const { wake, calls } = waking([delivery(1), delivery(2)]);

    await expect(wake()).resolves.toEqual({ kind: 'settled' });

    expect(handedCalls(calls)).toEqual([`handed(${delivery(1).deliveryId}, 1, web-push)`, `handed(${delivery(2).deliveryId}, 1, web-push)`]);
  });

  it('wakes them while a page of theirs is open and not in focus', async () => {
    await subscriptions.save(aWebPushSubscription());
    await focused.save({ ...SHIP, pageId: 'page-1', seenAt: new Date(NOW.getTime() - FOCUS_FRESH_MS - 1) });
    const { wake } = waking([delivery(1)]);

    await wake();

    expect(push.sent).toHaveLength(1);
  });

  it('sends no wake while a page of theirs is in focus, and reports each fresh delivery handed through the page', async () => {
    await subscriptions.save(aWebPushSubscription());
    await focused.save({ ...SHIP, pageId: 'page-1', seenAt: new Date(NOW.getTime() - FOCUS_FRESH_MS) });
    const { wake, calls } = waking([delivery(1)]);

    await expect(wake()).resolves.toEqual({ kind: 'settled' });

    expect(push.sent).toEqual([]);
    expect(handedCalls(calls)).toEqual([`handed(${delivery(1).deliveryId}, 1, page)`]);
  });

  it('hands through the page even while no channel is on', async () => {
    await focused.save({ ...SHIP, pageId: 'page-1', seenAt: NOW });
    const { wake, calls } = waking([delivery(1)]);

    await wake();

    expect(handedCalls(calls)).toEqual([`handed(${delivery(1).deliveryId}, 1, page)`]);
  });

  it('wakes no one for deliveries handed before, as after a crash once handed', async () => {
    await subscriptions.save(aWebPushSubscription());
    const { wake, calls } = waking([delivery(1, { handOverNumber: 1 })]);

    await expect(wake()).resolves.toEqual({ kind: 'settled' });

    expect(push.sent).toEqual([]);
    expect(handedCalls(calls)).toEqual([]);
  });

  it('wakes again for a delivery the fleet still holds never handed, as after a crash between the wake and its hand-over', async () => {
    await subscriptions.save(aWebPushSubscription());
    const { wake, calls, refusals } = waking([delivery(1)]);
    refusals.handed.push({ code: 'UNAVAILABLE', message: 'The fleet did not answer' });
    await wake();
    now = new Date(NOW.getTime() + WINDOW_MS);

    await wake();

    expect(push.sent).toHaveLength(2);
    expect(handedCalls(calls)).toEqual([`handed(${delivery(1).deliveryId}, 1, web-push)`, `handed(${delivery(1).deliveryId}, 1, web-push)`]);
  });

  it('gives ten deliveries in one window one wake and ten hand-overs', async () => {
    await subscriptions.save(aWebPushSubscription());
    const deliveries = Array.from({ length: 10 }, (_, index) => delivery(index + 1));
    const { wake, calls } = waking(deliveries);

    await wake();

    expect(push.sent).toHaveLength(1);
    expect(handedCalls(calls)).toHaveLength(10);
  });

  it('sends no second wake inside the window: it says when the window ends, and hands nothing yet', async () => {
    await subscriptions.save(aWebPushSubscription());
    await wakes.record(SHIP, { channel: 'web-push', at: new Date(NOW.getTime() - WINDOW_MS + 1) });
    const { wake, calls } = waking([delivery(1)]);

    await expect(wake()).resolves.toEqual({ kind: 'windowOpen', endsAt: new Date(NOW.getTime() + 1) });

    expect(push.sent).toEqual([]);
    expect(handedCalls(calls)).toEqual([]);
  });

  it('sends the next wake once the window ended, and starts a new window', async () => {
    await subscriptions.save(aWebPushSubscription());
    await wakes.record(SHIP, { channel: 'web-push', at: new Date(NOW.getTime() - WINDOW_MS) });
    const { wake } = waking([delivery(1)]);

    await wake();

    expect(push.sent).toHaveLength(1);
    expect(wakes.held.get(`${FLEET_ID}/${PERSON_SHIP_ID}/web-push`)).toEqual(NOW);
  });

  it('forgets a subscription its push service says is gone, keeping it shown as gone, and sends it nothing again', async () => {
    await subscriptions.save(aWebPushSubscription());
    push.answers.set(aWebPushSubscription().endpoint, ['gone']);
    const { wake } = waking([delivery(1)]);
    await wake();
    now = new Date(NOW.getTime() + WINDOW_MS);

    await wake();

    expect(subscriptions.held).toEqual([aWebPushSubscription({ goneAt: NOW })]);
    expect(push.sent).toEqual([]);
  });

  it('hands nothing when every subscription was gone', async () => {
    await subscriptions.save(aWebPushSubscription());
    push.answers.set(aWebPushSubscription().endpoint, ['gone']);
    const { wake, calls } = waking([delivery(1)]);

    await expect(wake()).resolves.toEqual({ kind: 'settled' });

    expect(handedCalls(calls)).toEqual([]);
  });

  it('hands nothing when the push service failed, and says so, to be tried again', async () => {
    await subscriptions.save(aWebPushSubscription());
    push.answers.set(aWebPushSubscription().endpoint, ['failed']);
    const { wake, calls } = waking([delivery(1)]);

    await expect(wake()).resolves.toEqual({ kind: 'failed' });

    expect(handedCalls(calls)).toEqual([]);
    expect(wakes.held.size).toBe(0);
  });

  it('hands every covered delivery once one browser took the wake, though another failed', async () => {
    await subscriptions.save(aWebPushSubscription({ endpoint: 'https://push.example/firefox' }));
    await subscriptions.save(aWebPushSubscription({ endpoint: 'https://push.example/chrome' }));
    push.answers.set('https://push.example/firefox', ['failed']);
    const { wake, calls } = waking([delivery(1)]);

    await expect(wake()).resolves.toEqual({ kind: 'settled' });

    expect(handedCalls(calls)).toEqual([`handed(${delivery(1).deliveryId}, 1, web-push)`]);
  });

  it('says it failed when the fleet did not hand over the deliveries, to be tried again', async () => {
    const { wake, refusals } = waking([delivery(1)]);
    refusals.pushReceive.push({ code: 'UNAVAILABLE', message: 'The fleet did not answer' });

    await expect(wake()).resolves.toEqual({ kind: 'failed' });
  });
});
