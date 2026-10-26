import type { DeliveryId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aPersonDelivery, memoryFocusedPages } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import type { FleetRefusal } from '../connection/ports.js';
import { err, ok, type Result } from '../shared/result.js';
import type { FocusedPages, PersonShip, PushedPersonDelivery, WakeChannel, WakeChannelName, WakesSent } from './ports.js';
import { createWakePerson } from './wake-person.js';

// The gateway wakes a person when something waits for their person ship
// (wake a person, W3, W8): each delivery never handed is woken once, through
// the channels the person turned on, each at most once per its window, and
// handed no. 1 naming the first channel that went out.

const SHIP: PersonShip = { fleetId: FLEET_ID, shipId: PERSON_SHIP_ID };
const CREW_TOKEN = 'aeolus_ct_v1_charlotte';
const NOW = new Date('2026-10-23T12:00:00.000Z');
const HOUR_MS = 3_600_000;
const FOCUS_FRESH_MS = 60_000;

function aDelivery(index: number, overrides: Partial<PushedPersonDelivery> = {}): PushedPersonDelivery {
  const deliveryId: DeliveryId = `dlv_01m3tbfspe96yf1rnr4ank${String(index).padStart(4, '0')}`;
  return { ...aPersonDelivery({ deliveryId }), handOverNumber: null, ...overrides };
}

/** A channel the test holds: on or off, sending or failing, each wake it sent recorded. */
function aChannel(name: WakeChannelName, options: { isOn?: boolean; windowMs?: number; isFailing?: boolean; isRefusing?: boolean } = {}) {
  const woken: PersonShip[] = [];
  const channel: WakeChannel = {
    name,
    windowMs: options.windowMs ?? HOUR_MS,
    isOn: () => Promise.resolve(options.isOn ?? true),
    wake: (ship) => {
      if (options.isFailing === true) {
        return Promise.resolve(err({ kind: 'unavailable' as const, reason: 'pagasae did not answer' }));
      }
      if (options.isRefusing === true) {
        return Promise.resolve(err({ kind: 'refused' as const, reason: 'pagasae answered 404: unknown_person_ship' }));
      }
      woken.push(ship);
      return Promise.resolve(ok(undefined));
    },
  };
  return { channel, woken };
}

function memoryWakesSent(sent: { channel: WakeChannelName; at: Date }[] = []): WakesSent & { sent: typeof sent } {
  return {
    sent,
    lastSentAt: (ship, channel) => Promise.resolve(ship.fleetId === SHIP.fleetId && ship.shipId === SHIP.shipId ? sent.findLast((wake) => wake.channel === channel)?.at : undefined),
    record: ({ channel, sentAt }) => {
      sent.push({ channel, at: sentAt });
      return Promise.resolve();
    },
  };
}

/** The person ship's deliveries in the fleet, as its push receive hands them, and the hand-overs the gateway reported. */
function aShip(deliveries: PushedPersonDelivery[], options: { pushReceive?: FleetRefusal } = {}) {
  const handOvers: { deliveryId: DeliveryId; handOverNumber: number; channel: string }[] = [];
  return {
    handOvers,
    door: {
      pushReceive: (crewToken: string): Promise<Result<PushedPersonDelivery[], FleetRefusal>> =>
        Promise.resolve(
          options.pushReceive !== undefined
            ? err(options.pushReceive)
            : crewToken === CREW_TOKEN
              ? ok(deliveries.map((delivery) => (handOvers.some(({ deliveryId }) => deliveryId === delivery.deliveryId) ? { ...delivery, handOverNumber: 1 } : delivery)))
              : err({ code: 'UNAUTHORIZED', message: 'no' }),
        ),
      handed: (_crewToken: string, handOver: { deliveryId: DeliveryId; handOverNumber: number; channel: string }): Promise<Result<'handed' | 'acknowledged' | 'undeliverable', FleetRefusal>> => {
        handOvers.push(handOver);
        return Promise.resolve(ok('handed'));
      },
    },
  };
}

function waking(deps: { ship: ReturnType<typeof aShip>; channels: WakeChannel[]; wakesSent?: WakesSent; focused?: FocusedPages; endedAttempts?: { channel: WakeChannelName; reason: string }[] }) {
  return createWakePerson({
    attemptEnded: (ended) => deps.endedAttempts?.push({ channel: ended.channel, reason: ended.reason }),
    door: deps.ship.door,
    channels: deps.channels,
    wakesSent: deps.wakesSent ?? memoryWakesSent(),
    focused: deps.focused ?? memoryFocusedPages(),
    focusFreshMs: FOCUS_FRESH_MS,
    clock: { now: () => NOW },
  });
}

describe('waking a person', () => {
  it('sends no wake and hands nothing while the person turned no channel on', async () => {
    const ship = aShip([aDelivery(1)]);
    const email = aChannel('email', { isOn: false });

    const woken = await waking({ ship, channels: [email.channel] })(SHIP, CREW_TOKEN);

    expect(woken).toEqual(ok({ kind: 'settled' }));
    expect(email.woken).toEqual([]);
    expect(ship.handOvers).toEqual([]);
  });

  it('wakes through a channel the person turned on, and hands each delivery no. 1 naming that channel', async () => {
    const ship = aShip([aDelivery(1), aDelivery(2)]);
    const email = aChannel('email');
    const wakesSent = memoryWakesSent();

    const woken = await waking({ ship, channels: [email.channel], wakesSent })(SHIP, CREW_TOKEN);

    expect(woken).toEqual(ok({ kind: 'settled' }));
    expect(email.woken).toEqual([SHIP]);
    expect(ship.handOvers).toEqual([
      { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001', handOverNumber: 1, channel: 'email' },
      { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', handOverNumber: 1, channel: 'email' },
    ]);
    expect(wakesSent.sent).toEqual([{ channel: 'email', at: NOW }]);
  });

  it('wakes no one for deliveries handed before: each delivery is woken once', async () => {
    const ship = aShip([aDelivery(1, { handOverNumber: 1 })]);
    const email = aChannel('email');

    const woken = await waking({ ship, channels: [email.channel] })(SHIP, CREW_TOKEN);

    expect(woken).toEqual(ok({ kind: 'settled' }));
    expect(email.woken).toEqual([]);
    expect(ship.handOvers).toEqual([]);
  });

  it('wakes only for what was never handed, and hands only that', async () => {
    const ship = aShip([aDelivery(1, { handOverNumber: 1 }), aDelivery(2)]);
    const email = aChannel('email');

    await waking({ ship, channels: [email.channel] })(SHIP, CREW_TOKEN);

    expect(ship.handOvers.map(({ deliveryId }) => deliveryId)).toEqual(['dlv_01m3tbfspe96yf1rnr4ank0002']);
  });

  it("sends no second wake inside the channel's window, and looks again once it ends", async () => {
    const ship = aShip([aDelivery(1, { sentAt: new Date('2026-10-23T11:45:00.000Z') })]);
    const email = aChannel('email');
    const wakesSent = memoryWakesSent([{ channel: 'email', at: new Date('2026-10-23T11:30:00.000Z') }]);

    const woken = await waking({ ship, channels: [email.channel], wakesSent })(SHIP, CREW_TOKEN);

    expect(woken).toEqual(ok({ kind: 'inWindow', until: new Date('2026-10-23T12:30:00.000Z') }));
    expect(email.woken).toEqual([]);
    expect(ship.handOvers).toEqual([]);
  });

  it('wakes again once the window has just ended', async () => {
    const ship = aShip([aDelivery(1)]);
    const email = aChannel('email');
    const wakesSent = memoryWakesSent([{ channel: 'email', at: new Date('2026-10-23T11:00:00.000Z') }]);

    await waking({ ship, channels: [email.channel], wakesSent })(SHIP, CREW_TOKEN);

    expect(email.woken).toEqual([SHIP]);
  });

  it('gathers every delivery that waited out the window into one wake, each handed', async () => {
    const deliveries = Array.from({ length: 10 }, (_, index) => aDelivery(index + 1));
    const ship = aShip(deliveries);
    const email = aChannel('email');

    await waking({ ship, channels: [email.channel] })(SHIP, CREW_TOKEN);

    expect(email.woken).toHaveLength(1);
    expect(ship.handOvers).toHaveLength(10);
  });

  it('hands nothing when the wake did not go out, and says it failed so it is tried again', async () => {
    const ship = aShip([aDelivery(1)]);
    const email = aChannel('email', { isFailing: true });
    const wakesSent = memoryWakesSent();

    const woken = await waking({ ship, channels: [email.channel], wakesSent })(SHIP, CREW_TOKEN);

    expect(woken).toEqual(ok({ kind: 'failed' }));
    expect(ship.handOvers).toEqual([]);
    expect(wakesSent.sent).toEqual([]);
  });

  it('wakes through every channel turned on, and hands each delivery once, naming the first that went out', async () => {
    const ship = aShip([aDelivery(1)]);
    const webPush = aChannel('web-push', { isFailing: true });
    const email = aChannel('email');

    await waking({ ship, channels: [webPush.channel, email.channel] })(SHIP, CREW_TOKEN);

    expect(email.woken).toEqual([SHIP]);
    expect(ship.handOvers).toEqual([{ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001', handOverNumber: 1, channel: 'email' }]);
  });

  it('wakes again after the gateway stopped between the wake and its hand-over, as nothing was handed (one wake more, nothing lost)', async () => {
    const ship = aShip([aDelivery(1)]);
    const email = aChannel('email');
    const wakesSent = memoryWakesSent();
    const crashing = { ...ship.door, handed: () => Promise.reject(new Error('the gateway stopped')) };
    await expect(createWakePerson({ attemptEnded: () => undefined, door: crashing, channels: [email.channel], wakesSent, focused: memoryFocusedPages(), focusFreshMs: FOCUS_FRESH_MS, clock: { now: () => NOW } })(SHIP, CREW_TOKEN)).rejects.toThrow('the gateway stopped');

    await waking({ ship, channels: [email.channel], wakesSent })(SHIP, CREW_TOKEN);

    expect({ woken: email.woken.length, handOvers: ship.handOvers.map(({ channel }) => channel) }).toEqual({ woken: 2, handOvers: ['email'] });
  });

  it('keeps the window of a wake that went out though the fleet refused a hand-over, so no second email follows at once', async () => {
    const ship = aShip([aDelivery(1)]);
    const refusing = { ...ship.door, handed: () => Promise.resolve(err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' })) };
    const wakesSent = memoryWakesSent();

    const woken = await createWakePerson({ attemptEnded: () => undefined, door: refusing, channels: [aChannel('email').channel], wakesSent, focused: memoryFocusedPages(), focusFreshMs: FOCUS_FRESH_MS, clock: { now: () => NOW } })(SHIP, CREW_TOKEN);

    expect({ woken, sent: wakesSent.sent }).toEqual({ woken: err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' }), sent: [{ channel: 'email', at: NOW }] });
  });

  it('hands the deliveries a refusal left over with the email already sent, and sends no second email', async () => {
    const ship = aShip([aDelivery(1), aDelivery(2), aDelivery(3)]);
    const email = aChannel('email');
    const wakesSent = memoryWakesSent();
    let handedCalls = 0;
    const refusingOnce = {
      ...ship.door,
      handed: (crewToken: string, handOver: Parameters<typeof ship.door.handed>[1]) => {
        handedCalls += 1;
        return handedCalls === 2 ? Promise.resolve(err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' })) : ship.door.handed(crewToken, handOver);
      },
    };
    const wakePerson = createWakePerson({ attemptEnded: () => undefined, door: refusingOnce, channels: [email.channel], wakesSent, focused: memoryFocusedPages(), focusFreshMs: FOCUS_FRESH_MS, clock: { now: () => NOW } });

    const first = await wakePerson(SHIP, CREW_TOKEN);
    const retried = await wakePerson(SHIP, CREW_TOKEN);

    expect({ first: first.isOk, retried, woken: email.woken.length, handOvers: ship.handOvers.map(({ deliveryId, channel }) => `${deliveryId.slice(-4)} ${channel}`) }).toEqual({
      first: false,
      retried: ok({ kind: 'settled' }),
      woken: 1,
      handOvers: ['0001 email', '0002 email', '0003 email'],
    });
  });

  it('leaves a delivery that arrived after the email waiting for the next window', async () => {
    const ship = aShip([aDelivery(1, { sentAt: new Date('2026-10-23T11:30:00.000Z') }), aDelivery(2, { sentAt: new Date('2026-10-23T11:45:00.000Z') })]);
    const email = aChannel('email');
    const wakesSent = memoryWakesSent([{ channel: 'email', at: new Date('2026-10-23T11:40:00.000Z') }]);

    const woken = await waking({ ship, channels: [email.channel], wakesSent })(SHIP, CREW_TOKEN);

    expect({ woken, handOvers: ship.handOvers.map(({ deliveryId, channel }) => `${deliveryId.slice(-4)} ${channel}`) }).toEqual({ woken: ok({ kind: 'inWindow', until: new Date('2026-10-23T12:40:00.000Z') }), handOvers: ['0001 email'] });
  });

  it('ends the attempt and logs it when a channel refused the wake for good, as trying again cannot help', async () => {
    const ship = aShip([aDelivery(1)]);
    const email = aChannel('email', { isRefusing: true });
    const endedAttempts: { channel: WakeChannelName; reason: string }[] = [];

    const woken = await waking({ ship, channels: [email.channel], endedAttempts })(SHIP, CREW_TOKEN);

    expect({ woken, endedAttempts, handOvers: ship.handOvers }).toEqual({ woken: ok({ kind: 'settled' }), endedAttempts: [{ channel: 'email', reason: 'pagasae answered 404: unknown_person_ship' }], handOvers: [] });
  });

  it('does not retry a channel that refused for good when another due channel was unavailable', async () => {
    const ship = aShip([aDelivery(1)]);
    const email = aChannel('email', { isRefusing: true });
    const push = aChannel('web-push', { isFailing: true });
    let emailAsked = 0;
    const countingEmail: WakeChannel = { ...email.channel, wake: (asked) => ((emailAsked += 1), email.channel.wake(asked)) };
    const wakePerson = waking({ ship, channels: [countingEmail, push.channel] });

    const first = await wakePerson(SHIP, CREW_TOKEN);
    const retry = await wakePerson(SHIP, CREW_TOKEN);

    expect({ first, retry, emailAsked }).toEqual({ first: ok({ kind: 'failed' }), retry: ok({ kind: 'failed' }), emailAsked: 1 });
  });

  it('says what the fleet refused, waking no one', async () => {
    const ship = aShip([aDelivery(1)], { pushReceive: { code: 'LEASE_ENDED', message: 'The lease ended' } });
    const email = aChannel('email');

    const woken = await waking({ ship, channels: [email.channel] })(SHIP, CREW_TOKEN);

    expect(woken).toEqual(err({ code: 'LEASE_ENDED', message: 'The lease ended' }));
    expect(email.woken).toEqual([]);
  });
});

describe('waking a person while a page of theirs is in focus (wake a person, W6)', () => {
  it('sends no wake, and hands each fresh delivery no. 1 through the page', async () => {
    const ship = aShip([aDelivery(1), aDelivery(2, { handOverNumber: 1 })]);
    const email = aChannel('email');
    const focused = memoryFocusedPages();
    await focused.save({ ...SHIP, pageId: 'page-1', seenAt: new Date(NOW.getTime() - FOCUS_FRESH_MS) });

    const woken = await waking({ ship, channels: [email.channel], focused })(SHIP, CREW_TOKEN);

    expect(woken).toEqual(ok({ kind: 'settled' }));
    expect(email.woken).toEqual([]);
    expect(ship.handOvers).toEqual([{ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001', handOverNumber: 1, channel: 'page' }]);
  });

  it('hands through the page though no channel is on', async () => {
    const ship = aShip([aDelivery(1)]);
    const focused = memoryFocusedPages();
    await focused.save({ ...SHIP, pageId: 'page-1', seenAt: NOW });

    await waking({ ship, channels: [aChannel('email', { isOn: false }).channel], focused })(SHIP, CREW_TOKEN);

    expect(ship.handOvers.map(({ channel }) => channel)).toEqual(['page']);
  });

  it('hands through the page though the window of every channel is open', async () => {
    const ship = aShip([aDelivery(1)]);
    const focused = memoryFocusedPages();
    await focused.save({ ...SHIP, pageId: 'page-1', seenAt: NOW });

    await waking({ ship, channels: [aChannel('email').channel], focused, wakesSent: memoryWakesSent([{ channel: 'email', at: NOW }]) })(SHIP, CREW_TOKEN);

    expect(ship.handOvers.map(({ channel }) => channel)).toEqual(['page']);
  });

  it('wakes them while a page of theirs is open and not in focus', async () => {
    const ship = aShip([aDelivery(1)]);
    const email = aChannel('email');
    const focused = memoryFocusedPages();
    await focused.save({ ...SHIP, pageId: 'page-1', seenAt: new Date(NOW.getTime() - FOCUS_FRESH_MS - 1) });

    await waking({ ship, channels: [email.channel], focused })(SHIP, CREW_TOKEN);

    expect({ woken: email.woken, channels: ship.handOvers.map(({ channel }) => channel) }).toEqual({ woken: [SHIP], channels: ['email'] });
  });

  it("is not kept from waking by another person's page in focus", async () => {
    const ship = aShip([aDelivery(1)]);
    const email = aChannel('email');
    const focused = memoryFocusedPages();
    await focused.save({ fleetId: FLEET_ID, shipId: 'shp_01m3tb1zgr5h2ffee12xnch8zz', pageId: 'page-1', seenAt: NOW });

    await waking({ ship, channels: [email.channel], focused })(SHIP, CREW_TOKEN);

    expect(email.woken).toEqual([SHIP]);
  });
});
