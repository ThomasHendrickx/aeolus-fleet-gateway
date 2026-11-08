import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aPersonDelivery, aWebPushSubscription, fakePersonShipDoor, fakeWebPush, holding, memoryOpenedDeliveries, memoryWebPushSubscriptions } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { err, ok } from '../shared/result.js';
import type { PersonDelivery, WakeWindow } from './ports.js';
import { createCountWaitingOn } from './read-waiting-count.js';
import { createWebPushChannel } from './web-push-channel.js';

// Web push, a channel that wakes a person (wake a person, W1, W4, W8): on
// while they turned it on in a browser, it sends each such browser a wake
// that says the fleet by its name, the Bridge link, who sent what it is for
// and its job, where it is, and how much waits, never what it says. A wake
// for argo's inbox says only the fleet and the link.

const SHIP = { fleetId: FLEET_ID, shipId: PERSON_SHIP_ID };
const NOW = new Date('2026-10-23T10:00:00.000Z');
const WINDOW_MS = 10 * 60 * 1000;
const OVERVIEW_URL = `https://gateway.example/bridge?fleet=${FLEET_ID}`;

const CREW_TOKEN = 'aeolus_ct_v1_charlotte';

const QUESTION = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001' });
const STEP = aPersonDelivery({
  deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002',
  senderShipId: 'shp_01m3tbfspe96yf1rnr4ank0bld',
  senderName: 'builder',
  contentType: 'application/vnd.aeolus.step+json',
  payload: '{"id":"s-1","title":"Create the repository","why":"The build needs it."}',
  headline: 'Create the repository',
  askedQuestionId: null,
  stepId: 's-1',
});
const MESSAGE = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0003', contentType: 'text/plain', payload: 'The build is red', headline: null, askedQuestionId: null });
const ALERT = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0004', contentType: 'application/vnd.aeolus.alert+json', payload: '{"headline":"Disk full"}', headline: 'Disk full', askedQuestionId: null });

let subscriptions: ReturnType<typeof memoryWebPushSubscriptions>;
let push: ReturnType<typeof fakeWebPush>;
let ship: ReturnType<typeof fakePersonShipDoor>;

beforeEach(() => {
  subscriptions = memoryWebPushSubscriptions();
  push = fakeWebPush();
  ship = fakePersonShipDoor({ crewToken: CREW_TOKEN, deliveries: [QUESTION] });
});

/** The person ship's own wake, for the deliveries it covers. */
function forPersonShip(deliveries: readonly PersonDelivery[]): WakeWindow {
  return { key: 'window-1', waitsAt: 'personShip', crewToken: CREW_TOKEN, deliveries };
}

function webPushChannel() {
  const { door, held } = holding(ship.door);
  return createWebPushChannel({
    subscriptions,
    webPush: push.webPush,
    countWaiting: createCountWaitingOn({ door, held, opened: memoryOpenedDeliveries() }),
    clock: { now: () => NOW },
    windowMs: WINDOW_MS,
    bridgeUrlOf: (fleetId) => `https://gateway.example/bridge?fleet=${fleetId}`,
  });
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

  it('wakes each browser they turned on for one delivery: the fleet, the Bridge link, its sender and job, the delivery, ship and fleet ids, and the count', async () => {
    await subscriptions.save(aWebPushSubscription({ endpoint: 'https://push.example/firefox' }));
    await subscriptions.save(aWebPushSubscription({ endpoint: 'https://push.example/chrome', browser: 'Chrome on macOS' }));

    await expect(webPushChannel().wake(SHIP, forPersonShip([QUESTION]))).resolves.toEqual(ok(undefined));

    const wake = { fleetName: 'Acme', bridgeUrl: OVERVIEW_URL, waitsAt: 'personShip', count: 1, senderName: 'tracker', job: 'question', deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001', senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9trk', fleetId: FLEET_ID };
    expect(push.sent).toEqual([
      { endpoint: 'https://push.example/firefox', wake },
      { endpoint: 'https://push.example/chrome', wake },
    ]);
  });

  it.each([
    { what: 'a step', delivery: STEP, job: 'step' },
    { what: 'an alert', delivery: ALERT, job: 'alert' },
    { what: 'a notice', delivery: aPersonDelivery({ contentType: 'application/vnd.aeolus.notice+json', askedQuestionId: null }), job: 'notice' },
    { what: 'a plain message', delivery: MESSAGE, job: 'message' },
    { what: 'a question replacement', delivery: aPersonDelivery({ contentType: 'application/vnd.aeolus.question-replacement+json' }), job: 'question' },
    { what: 'a meeting notice', delivery: aPersonDelivery({ contentType: 'application/vnd.aeolus.meeting.added+json', askedQuestionId: null }), job: 'message' },
  ])('names the job of $what as Bridge reads its content type', async ({ delivery, job }) => {
    await subscriptions.save(aWebPushSubscription());

    await webPushChannel().wake(SHIP, forPersonShip([delivery]));

    expect(push.sent.map(({ wake }) => ('job' in wake ? wake.job : undefined))).toEqual([job]);
  });

  it('names, for several deliveries in one wake, how many of each job it covers and the count, and no sender or item', async () => {
    ship = fakePersonShipDoor({ crewToken: CREW_TOKEN, deliveries: [QUESTION, STEP, MESSAGE, ALERT] });
    await subscriptions.save(aWebPushSubscription());

    await webPushChannel().wake(SHIP, forPersonShip([QUESTION, STEP, MESSAGE, ALERT]));

    expect(push.sent.map(({ wake }) => wake)).toEqual([
      { fleetName: 'Acme', bridgeUrl: OVERVIEW_URL, waitsAt: 'personShip', count: 3, jobs: { question: 1, step: 1, alert: 1, notice: 0, message: 1 } },
    ]);
  });

  it("never says an item's title, text or options", async () => {
    ship = fakePersonShipDoor({ crewToken: CREW_TOKEN, deliveries: [QUESTION, STEP] });
    await subscriptions.save(aWebPushSubscription());
    const channel = webPushChannel();

    await channel.wake(SHIP, forPersonShip([QUESTION]));
    await channel.wake(SHIP, forPersonShip([QUESTION, STEP]));

    const said = JSON.stringify(push.sent);
    expect(['Go for release 1.4?', 'All checks are green.', '"Go"', 'Create the repository', 'The build needs it.'].filter((text) => said.includes(text))).toEqual([]);
  });

  it('counts what waits on the person ship at send time, once per wake for every browser, never from the record', async () => {
    ship = fakePersonShipDoor({ crewToken: CREW_TOKEN, deliveries: [QUESTION, STEP, MESSAGE] });
    await subscriptions.save(aWebPushSubscription({ endpoint: 'https://push.example/firefox' }));
    await subscriptions.save(aWebPushSubscription({ endpoint: 'https://push.example/chrome' }));

    await webPushChannel().wake(SHIP, forPersonShip([QUESTION]));

    expect({ counts: push.sent.map(({ wake }) => ('count' in wake ? wake.count : undefined)), inboxReads: ship.calls.filter((call) => call === 'inbox').length, recordReads: ship.calls.filter((call) => call.startsWith('record')).length }).toEqual({ counts: [3, 3], inboxReads: 1, recordReads: 0 });
  });

  it('did not go out while the fleet does not answer the count, to be tried again, sending nothing', async () => {
    await subscriptions.save(aWebPushSubscription());
    ship.refusals.inbox.push({ code: 'UNAVAILABLE', message: 'core is restarting' });

    const woken = await webPushChannel().wake(SHIP, forPersonShip([QUESTION]));

    expect({ woken, sent: push.sent }).toEqual({ woken: err({ kind: 'unavailable', reason: 'the fleet did not answer the count of what waits: core is restarting' }), sent: [] });
  });

  it("wakes for argo's inbox as before: the fleet by its name and the Bridge link, nothing else, counting nothing", async () => {
    await subscriptions.save(aWebPushSubscription());

    await webPushChannel().wake(SHIP, { key: 'argo:web-push:first', waitsAt: 'argo' });

    expect({ sent: push.sent, calls: ship.calls }).toEqual({ sent: [{ endpoint: aWebPushSubscription().endpoint, wake: { fleetName: 'Acme', bridgeUrl: OVERVIEW_URL, waitsAt: 'argo' } }], calls: [] });
  });

  it('went out once one browser took it, though another failed', async () => {
    await subscriptions.save(aWebPushSubscription({ endpoint: 'https://push.example/firefox' }));
    await subscriptions.save(aWebPushSubscription({ endpoint: 'https://push.example/chrome' }));
    push.answers.set('https://push.example/firefox', ['failed']);

    await expect(webPushChannel().wake(SHIP, forPersonShip([QUESTION]))).resolves.toEqual(ok(undefined));
  });

  it('did not go out when every push service failed, to be tried again', async () => {
    await subscriptions.save(aWebPushSubscription());
    push.answers.set(aWebPushSubscription().endpoint, ['failed']);

    await expect(webPushChannel().wake(SHIP, forPersonShip([QUESTION]))).resolves.toEqual(err({ kind: 'unavailable', reason: 'no push service took the wake' }));
  });

  it('forgets a subscription its push service says is gone, keeping it shown as gone, and sends it nothing again', async () => {
    await subscriptions.save(aWebPushSubscription());
    push.answers.set(aWebPushSubscription().endpoint, ['gone']);

    const woken = await webPushChannel().wake(SHIP, forPersonShip([QUESTION]));
    await webPushChannel().wake(SHIP, forPersonShip([QUESTION]));

    expect({ woken, held: subscriptions.held, sent: push.sent }).toEqual({ woken: err({ kind: 'unavailable', reason: 'no push service took the wake' }), held: [aWebPushSubscription({ goneAt: NOW })], sent: [] });
  });
});
