import { beforeEach, describe, expect, it } from 'vitest';

import { anArgoEntry, fakeArgoInboxFleet, memoryArgoAccounts, memoryArgoWakes } from '../../../test/support/argo-inbox-fakes.js';
import { FLEET_ID, memoryConnectionStore, SHIP_ID } from '../../../test/support/fleet-fakes.js';
import { memoryFocusedPages, memoryRoutes } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import type { PersonShip, WakeChannel, WakeChannelName, WakeWindow } from '../people/ports.js';
import { createPersonWakes } from '../people/person-wakes.js';
import { ITEM_JOBS, routingDefaultsOf, type Route } from '../people/routing.js';
import { ok } from '../shared/result.js';
import { createFollowArgoInbox } from './follow-argo-inbox.js';
import { createWakeForArgo } from './wake-for-argo.js';

// For each message open at argo, every person ship of an account allowed as
// argo gets a wake of its own, saying it waits at argo (argo's inbox, AI4,
// AI5): following the person's own rules (wake a person, W1 to W10), and
// kept apart from the person's own wake.

const MATHILDE_SHIP_ID = 'shp_01m3tb1zgr5h2ffee12xnch8mm';
const THOMAS: PersonShip = { fleetId: FLEET_ID, shipId: PERSON_SHIP_ID };
const MATHILDE: PersonShip = { fleetId: FLEET_ID, shipId: MATHILDE_SHIP_ID };
const START = new Date('2026-11-01T20:12:00.000Z');
const MINUTE_MS = 60_000;
const WINDOW_MS = 10 * MINUTE_MS;
const FOCUS_FRESH_MS = MINUTE_MS;
const signal = new AbortController().signal;

/** Every job routed to both wake channels, as the person turned them on (W8). */
const EVERY_JOB_WAKES = routingDefaultsOf(ITEM_JOBS.flatMap((job) => [{ job, place: 'email' as const }, { job, place: 'web-push' as const }]));

/** A channel the test holds, on unless told, each wake it sent kept with its window. */
function aChannel(name: WakeChannelName, options: { isOn?: boolean } = {}) {
  const woken: { ship: PersonShip; window: WakeWindow }[] = [];
  const channel: WakeChannel = {
    name,
    windowMs: WINDOW_MS,
    isOn: () => Promise.resolve(options.isOn ?? true),
    wake: (ship, window) => {
      woken.push({ ship, window });
      return Promise.resolve(ok(undefined));
    },
  };
  return { channel, woken };
}

let now: Date;
let fleet: ReturnType<typeof fakeArgoInboxFleet>;
let follow: ReturnType<typeof createFollowArgoInbox>;
let accounts: ReturnType<typeof memoryArgoAccounts>;
let argoWakes: ReturnType<typeof memoryArgoWakes>;
let focused: ReturnType<typeof memoryFocusedPages>;
let connections: ReturnType<typeof memoryConnectionStore>;

beforeEach(async () => {
  now = START;
  connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: new Date('2026-11-01T08:00:00.000Z') });
  fleet = fakeArgoInboxFleet();
  follow = createFollowArgoInbox({ connections, door: fleet.door });
  accounts = memoryArgoAccounts();
  await accounts.keep(FLEET_ID, { accountId: 'acc-thomas', personShipId: PERSON_SHIP_ID });
  argoWakes = memoryArgoWakes();
  focused = memoryFocusedPages();
});

function waking(channels: WakeChannel[], routes: Route[] = []) {
  return createWakeForArgo({
    connections,
    accounts,
    inboxOf: follow.inboxOf,
    people: createPersonWakes({ channels, routes: memoryRoutes(routes), defaults: EVERY_JOB_WAKES, focused, focusFreshMs: FOCUS_FRESH_MS, clock: { now: () => now } }),
    argoWakes,
    clock: { now: () => now },
  });
}

/** The gateway's ship reads argo's inbox, then the argo wakes go out. */
async function round(wakeForArgo: ReturnType<typeof createWakeForArgo>): Promise<void> {
  await follow.round(signal);
  await wakeForArgo();
}

function later(minutes: number): void {
  now = new Date(now.getTime() + minutes * MINUTE_MS);
}

describe('the wake for what waits at argo', () => {
  it('wakes each person allowed as argo once per message', async () => {
    await accounts.keep(FLEET_ID, { accountId: 'acc-mathilde', personShipId: MATHILDE_SHIP_ID });
    const push = aChannel('web-push');
    const wakeForArgo = waking([push.channel]);
    fleet.send(anArgoEntry(1));

    await round(wakeForArgo);
    later(30);
    await round(wakeForArgo);

    expect(push.woken.map(({ ship }) => ship)).toEqual([THOMAS, MATHILDE]);
  });

  it('gives one wake for two messages in one window', async () => {
    const push = aChannel('web-push');
    const wakeForArgo = waking([push.channel]);
    fleet.send(anArgoEntry(1));
    await round(wakeForArgo);

    later(2);
    fleet.send(anArgoEntry(2));
    await round(wakeForArgo);
    later(2);
    fleet.send(anArgoEntry(3));
    await round(wakeForArgo);
    later(7);
    await round(wakeForArgo);
    later(30);
    await round(wakeForArgo);

    expect(push.woken.map(({ window }) => window.key)).toEqual(['argo:web-push:first', `argo:web-push:${START.toISOString()}`]);
  });

  it('gives no wake on a channel turned off', async () => {
    const push = aChannel('web-push', { isOn: false });
    const email = aChannel('email');
    const turnedOff: Route[] = ITEM_JOBS.map((job) => ({ ...THOMAS, job, place: 'email', isOn: false, changedAt: new Date('2026-10-30T00:00:00.000Z') }));
    fleet.send(anArgoEntry(1));

    await round(waking([push.channel, email.channel], turnedOff));

    expect([...push.woken, ...email.woken]).toEqual([]);
  });

  it('gives no wake while a page of the person is in focus, nor later for what it showed', async () => {
    const push = aChannel('web-push');
    const wakeForArgo = waking([push.channel]);
    await focused.save({ ...THOMAS, pageId: 'page-1', seenAt: START });
    fleet.send(anArgoEntry(1));
    await round(wakeForArgo);

    await focused.remove(FLEET_ID, 'page-1');
    later(30);
    await round(wakeForArgo);

    expect(push.woken).toEqual([]);
  });

  it('gives no wake for a message done at argo before its window passed', async () => {
    const push = aChannel('web-push');
    const wakeForArgo = waking([push.channel]);
    fleet.send(anArgoEntry(1));
    await round(wakeForArgo);

    later(2);
    fleet.send(anArgoEntry(2));
    await round(wakeForArgo);
    later(3);
    fleet.markDone(anArgoEntry(2).messageId);
    await round(wakeForArgo);
    later(30);
    await round(wakeForArgo);

    expect(push.woken).toHaveLength(1);
  });

  it("keeps the argo wake apart from the person's own: its own window, saying it waits at argo", async () => {
    const push = aChannel('web-push');
    // The person's own wake went out just now: its window does not hold argo's back.
    await push.channel.wake(THOMAS, { key: 'web-push:first', waitsAt: 'personShip' });
    fleet.send(anArgoEntry(1));

    await round(waking([push.channel]));

    expect(push.woken.map(({ window }) => window)).toEqual([
      { key: 'web-push:first', waitsAt: 'personShip' },
      { key: 'argo:web-push:first', waitsAt: 'argo' },
    ]);
    expect(argoWakes.sent).toEqual([{ ship: THOMAS, channel: 'web-push', sentAt: START }]);
  });

  it('wakes nobody for argo while argo has not let the gateway read its inbox', async () => {
    const push = aChannel('web-push');
    fleet.state.isReadRuleOn = false;
    fleet.send(anArgoEntry(1));

    await round(waking([push.channel]));

    expect(push.woken).toEqual([]);
  });

  it('wakes an account no longer allowed as argo no more', async () => {
    const push = aChannel('web-push');
    await accounts.drop(FLEET_ID, 'acc-thomas');
    fleet.send(anArgoEntry(1));

    await round(waking([push.channel]));

    expect(push.woken).toEqual([]);
  });
});

describe('the wake for what waits at argo, at scale', () => {
  const OPEN_AT_ARGO = 1_000;
  const ALLOWED_AS_ARGO = 20;

  async function manyAllowedAsArgo(): Promise<void> {
    for (let index = 1; index < ALLOWED_AS_ARGO; index += 1) {
      await accounts.keep(FLEET_ID, { accountId: `acc-${String(index)}`, personShipId: `shp_01m3tb1zgr5h2ffee12xnch${String(index).padStart(3, '0')}` });
    }
  }

  function manyOpenAtArgo(): void {
    for (let number = 1; number <= OPEN_AT_ARGO; number += 1) {
      fleet.send(anArgoEntry(number, { sentAt: START }));
    }
  }

  it("reads and writes nothing of argo's wakes in a round where nothing changed at argo and no window passed", async () => {
    await manyAllowedAsArgo();
    manyOpenAtArgo();
    const wakeForArgo = waking([aChannel('web-push').channel]);
    await round(wakeForArgo);
    argoWakes.calls.length = 0;

    later(1);
    await round(wakeForArgo);

    expect(argoWakes.calls).toEqual([]);
  });

  it('asks only about the message that arrived, once per person, however many are open', async () => {
    await manyAllowedAsArgo();
    manyOpenAtArgo();
    const wakeForArgo = waking([aChannel('web-push').channel]);
    await round(wakeForArgo);
    argoWakes.calls.length = 0;

    later(1);
    fleet.send(anArgoEntry(OPEN_AT_ARGO + 1));
    await round(wakeForArgo);

    const asked = argoWakes.calls.filter(({ call }) => call === 'coveredAmong');
    expect({ persons: asked.length, messageIds: new Set(asked.flatMap(({ messageIds }) => messageIds)) }).toEqual({ persons: ALLOWED_AS_ARGO, messageIds: new Set([anArgoEntry(OPEN_AT_ARGO + 1).messageId]) });
  });

  it('forgets only the message done at argo', async () => {
    manyOpenAtArgo();
    const wakeForArgo = waking([aChannel('web-push').channel]);
    await round(wakeForArgo);
    argoWakes.calls.length = 0;

    fleet.markDone(anArgoEntry(7).messageId);
    await round(wakeForArgo);

    expect(argoWakes.calls).toEqual([{ call: 'forget', ship: THOMAS, messageIds: [anArgoEntry(7).messageId] }]);
  });
});
