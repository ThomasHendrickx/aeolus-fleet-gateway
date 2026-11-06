import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aPersonDelivery, CHARLOTTE_GRANT, fakeCrewPersonShip, fakePersonShipDoor, holding, memoryPersonCrews, memoryQuietHours } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { ok } from '../shared/result.js';
import type { PersonDelivery } from './ports.js';
import { createReadQuietHours } from './read-quiet-hours.js';
import { createSetQuietHours } from './set-quiet-hours.js';

// A person sets their quiet hours through the person API (preferences
// design): one daily window in the time zone of the device that set them,
// kept per fleet and person ship, off by default. A person's client reads
// them, and while they are in effect, since when, until when and how many
// of what waits arrived since.

const NOW = new Date('2026-11-06T23:30:00.000Z');
const TEN_PM = 22 * 60;
const SEVEN_AM = 7 * 60;
const BRUSSELS_NIGHT = { fromMinute: TEN_PM, toMinute: SEVEN_AM, timeZone: 'Europe/Brussels' };

let crews: ReturnType<typeof memoryPersonCrews>;
let quietHours: ReturnType<typeof memoryQuietHours>;

beforeEach(() => {
  crews = memoryPersonCrews();
  quietHours = memoryQuietHours();
});

const setQuietHours = () => createSetQuietHours({ crewPersonShip: fakeCrewPersonShip(crews), quietHours, clock: { now: () => NOW } });
function readQuietHours(now = NOW, waiting: PersonDelivery[] = []) {
  const { door, held } = holding(fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries: waiting }).door);
  return createReadQuietHours({ crewPersonShip: fakeCrewPersonShip(crews), crews, door, held, quietHours, clock: { now: () => now } });
}

/** A delivery waiting for the person, sent at the instant. */
const waitingSince = (index: number, sentAt: string) => aPersonDelivery({ deliveryId: `dlv_01m3tbfspe96yf1rnr4ank${String(index).padStart(4, '0')}`, sentAt: new Date(sentAt) });

describe('a person sets their quiet hours', () => {
  it('keeps them for their own person ship, with when they were set', async () => {
    const set = await setQuietHours()({ caller: CHARLOTTE_GRANT, isOn: true, ...BRUSSELS_NIGHT });

    expect({ set, held: quietHours.held }).toEqual({ set: ok(undefined), held: [{ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, isOn: true, ...BRUSSELS_NIGHT, changedAt: NOW }] });
  });

  it('keeps them anew when turned off, with their window', async () => {
    await setQuietHours()({ caller: CHARLOTTE_GRANT, isOn: true, ...BRUSSELS_NIGHT });

    await setQuietHours()({ caller: CHARLOTTE_GRANT, isOn: false, ...BRUSSELS_NIGHT });

    expect(quietHours.held.map(({ isOn, fromMinute }) => ({ isOn, fromMinute }))).toEqual([{ isOn: false, fromMinute: TEN_PM }]);
  });

  it('refuses a window that ends when it starts, keeping nothing', async () => {
    const set = await setQuietHours()({ caller: CHARLOTTE_GRANT, isOn: true, ...BRUSSELS_NIGHT, toMinute: TEN_PM });

    expect({ kind: set.isOk ? undefined : set.error.kind, held: quietHours.held }).toEqual({ kind: 'INVALID_QUIET_HOURS', held: [] });
  });

  it('is refused without a person ship, keeping nothing', async () => {
    const set = await setQuietHours()({ caller: { fleetId: FLEET_ID, grantId: 'grant-of-argo' }, isOn: true, ...BRUSSELS_NIGHT });

    expect({ kind: set.isOk ? undefined : set.error.kind, held: quietHours.held }).toEqual({ kind: 'NOT_A_PERSON', held: [] });
  });
});

describe("a person's client reads their quiet hours", () => {
  it('reads them off, with no window, while the person set none', async () => {
    await expect(readQuietHours()(CHARLOTTE_GRANT)).resolves.toEqual(ok({ isOn: false, window: null, quietNow: null }));
  });

  it('reads them on while in effect, with since when, until when and how many of what waits arrived since', async () => {
    await setQuietHours()({ caller: CHARLOTTE_GRANT, isOn: true, ...BRUSSELS_NIGHT });
    const waiting = [waitingSince(1, '2026-11-06T20:59:59.999Z'), waitingSince(2, '2026-11-06T21:00:00.000Z'), waitingSince(3, '2026-11-06T23:00:00.000Z')];

    await expect(readQuietHours(NOW, waiting)(CHARLOTTE_GRANT)).resolves.toEqual(ok({ isOn: true, window: BRUSSELS_NIGHT, quietNow: { since: new Date('2026-11-06T21:00:00.000Z'), until: new Date('2026-11-07T06:00:00.000Z'), arrived: 2 } }));
  });

  it('reads them on and not in effect outside their window', async () => {
    await setQuietHours()({ caller: CHARLOTTE_GRANT, isOn: true, ...BRUSSELS_NIGHT });

    await expect(readQuietHours(new Date('2026-11-07T12:00:00.000Z'))(CHARLOTTE_GRANT)).resolves.toEqual(ok({ isOn: true, window: BRUSSELS_NIGHT, quietNow: null }));
  });

  it('is refused without a person ship', async () => {
    const read = await readQuietHours()({ fleetId: FLEET_ID, grantId: 'grant-of-argo' });

    expect(read.isOk ? undefined : read.error.kind).toBe('NOT_A_PERSON');
  });
});
