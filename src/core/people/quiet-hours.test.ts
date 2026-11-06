import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { quietSpellAt, quietWindowOf, type QuietHours } from './quiet-hours.js';

// Quiet hours (preferences design): one daily window, a start and an end in
// the time zone of the device that set them, which may cross midnight. While
// in effect, nothing wakes the person through web push or email.

const SET_AT = new Date('2026-11-01T12:00:00.000Z');
const TEN_PM = 22 * 60;
const SEVEN_AM = 7 * 60;

function someQuietHours(overrides: Partial<QuietHours> = {}): QuietHours {
  return { fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, isOn: true, fromMinute: TEN_PM, toMinute: SEVEN_AM, timeZone: 'Europe/Brussels', changedAt: SET_AT, ...overrides };
}

describe('quiet hours', () => {
  it('are in effect inside a window of one day, since its start and until its end', () => {
    const hours = someQuietHours({ fromMinute: 13 * 60, toMinute: 15 * 60, timeZone: 'UTC' });
    expect(quietSpellAt(hours, new Date('2026-11-06T14:00:00.000Z'))).toEqual({ since: new Date('2026-11-06T13:00:00.000Z'), until: new Date('2026-11-06T15:00:00.000Z') });
  });

  it('are not in effect outside the window', () => {
    const hours = someQuietHours({ fromMinute: 13 * 60, toMinute: 15 * 60, timeZone: 'UTC' });
    expect(quietSpellAt(hours, new Date('2026-11-06T16:00:00.000Z'))).toBeUndefined();
  });

  it('are not in effect while turned off', () => {
    expect(quietSpellAt(someQuietHours({ isOn: false }), new Date('2026-11-06T23:30:00.000Z'))).toBeUndefined();
  });

  it('cross midnight in their time zone, after midnight', () => {
    // 00:30 in Brussels, winter time (UTC+1).
    expect(quietSpellAt(someQuietHours(), new Date('2026-11-06T23:30:00.000Z'))).toEqual({ since: new Date('2026-11-06T21:00:00.000Z'), until: new Date('2026-11-07T06:00:00.000Z') });
  });

  it('cross midnight in their time zone, before midnight', () => {
    // 22:30 in Brussels.
    expect(quietSpellAt(someQuietHours(), new Date('2026-11-06T21:30:00.000Z'))).toEqual({ since: new Date('2026-11-06T21:00:00.000Z'), until: new Date('2026-11-07T06:00:00.000Z') });
  });

  it('begin at their start and end at their end, to the minute', () => {
    const hours = someQuietHours();
    expect([quietSpellAt(hours, new Date('2026-11-06T21:00:00.000Z')) !== undefined, quietSpellAt(hours, new Date('2026-11-06T20:59:59.999Z')) !== undefined, quietSpellAt(hours, new Date('2026-11-07T06:00:00.000Z')) !== undefined, quietSpellAt(hours, new Date('2026-11-07T05:59:59.999Z')) !== undefined]).toEqual([true, false, false, true]);
  });

  it('end at the local time of their end across a change of the clocks', () => {
    // Brussels leaves summer time on 25 Oct 2026 at 03:00: 22:00 is UTC+2, 07:00 is UTC+1.
    expect(quietSpellAt(someQuietHours(), new Date('2026-10-24T23:00:00.000Z'))).toEqual({ since: new Date('2026-10-24T20:00:00.000Z'), until: new Date('2026-10-25T06:00:00.000Z') });
  });
});

describe('a quiet window', () => {
  it('takes a start and an end of the day in a known time zone', () => {
    expect(quietWindowOf({ fromMinute: TEN_PM, toMinute: SEVEN_AM, timeZone: 'Europe/Brussels' })).toEqual({ isOk: true, value: { fromMinute: TEN_PM, toMinute: SEVEN_AM, timeZone: 'Europe/Brussels' } });
  });

  it('refuses a start equal to its end', () => {
    expect(quietWindowOf({ fromMinute: TEN_PM, toMinute: TEN_PM, timeZone: 'Europe/Brussels' })).toMatchObject({ isOk: false, error: { kind: 'INVALID_QUIET_HOURS' } });
  });

  it('refuses a time zone it does not know', () => {
    expect(quietWindowOf({ fromMinute: TEN_PM, toMinute: SEVEN_AM, timeZone: 'Europe/Atlantis' })).toMatchObject({ isOk: false, error: { kind: 'INVALID_QUIET_HOURS' } });
  });

  it('takes the last minute of the day and refuses one past it', () => {
    expect([quietWindowOf({ fromMinute: 1439, toMinute: 0, timeZone: 'UTC' }).isOk, quietWindowOf({ fromMinute: 1440, toMinute: 0, timeZone: 'UTC' }).isOk, quietWindowOf({ fromMinute: -1, toMinute: 0, timeZone: 'UTC' }).isOk]).toEqual([true, false, false]);
  });
});
