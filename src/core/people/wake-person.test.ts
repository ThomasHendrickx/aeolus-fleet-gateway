import type { DeliveryId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aPersonDelivery } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import type { FleetRefusal } from '../connection/ports.js';
import { err, ok, type Result } from '../shared/result.js';
import type { PersonShip, PushedPersonDelivery, WakeChannel, WakeChannelName, WakesSent } from './ports.js';
import { createWakePerson } from './wake-person.js';

// The gateway wakes a person when something waits for their person ship
// (wake a person, W3, W8): each delivery never handed is woken once, through
// the channels the person turned on, each at most once per its window, and
// handed no. 1 naming the first channel that went out.

const SHIP: PersonShip = { fleetId: FLEET_ID, shipId: PERSON_SHIP_ID };
const CREW_TOKEN = 'aeolus_ct_v1_charlotte';
const NOW = new Date('2026-10-23T12:00:00.000Z');
const HOUR_MS = 3_600_000;

function aDelivery(index: number, overrides: Partial<PushedPersonDelivery> = {}): PushedPersonDelivery {
  const deliveryId: DeliveryId = `dlv_01m3tbfspe96yf1rnr4ank${String(index).padStart(4, '0')}`;
  return { ...aPersonDelivery({ deliveryId }), handOverNumber: null, ...overrides };
}

/** A channel the test holds: on or off, sending or failing, each wake it sent recorded. */
function aChannel(name: WakeChannelName, options: { isOn?: boolean; windowMs?: number; isFailing?: boolean } = {}) {
  const woken: PersonShip[] = [];
  const channel: WakeChannel = {
    name,
    windowMs: options.windowMs ?? HOUR_MS,
    isOn: () => Promise.resolve(options.isOn ?? true),
    wake: (ship) => {
      if (options.isFailing === true) {
        return Promise.resolve(err({ reason: 'pagasae did not answer' }));
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
        Promise.resolve(options.pushReceive !== undefined ? err(options.pushReceive) : crewToken === CREW_TOKEN ? ok(deliveries) : err({ code: 'UNAUTHORIZED', message: 'no' })),
      handed: (_crewToken: string, handOver: { deliveryId: DeliveryId; handOverNumber: number; channel: string }): Promise<Result<'handed' | 'acknowledged' | 'undeliverable', FleetRefusal>> => {
        handOvers.push(handOver);
        return Promise.resolve(ok('handed'));
      },
    },
  };
}

function waking(deps: { ship: ReturnType<typeof aShip>; channels: WakeChannel[]; wakesSent?: WakesSent }) {
  return createWakePerson({ door: deps.ship.door, channels: deps.channels, wakesSent: deps.wakesSent ?? memoryWakesSent(), clock: { now: () => NOW } });
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
    const ship = aShip([aDelivery(1)]);
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

  it('says what the fleet refused, waking no one', async () => {
    const ship = aShip([aDelivery(1)], { pushReceive: { code: 'LEASE_ENDED', message: 'The lease ended' } });
    const email = aChannel('email');

    const woken = await waking({ ship, channels: [email.channel] })(SHIP, CREW_TOKEN);

    expect(woken).toEqual(err({ code: 'LEASE_ENDED', message: 'The lease ended' }));
    expect(email.woken).toEqual([]);
  });
});
