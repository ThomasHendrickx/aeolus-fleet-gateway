/**
 * Quiet hours (preferences design): one daily window per fleet and person
 * ship, a start and an end in the time zone of the device that set them,
 * which may cross midnight. While in effect nothing wakes the person through
 * web push or email; at their end each channel on sends one wake for what
 * still waits (W3). Off by default. Read in the window's own time zone, so
 * a change of the clocks moves neither its start nor its end.
 */
import type { FleetId, ShipId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { PersonShip } from './ports.js';

const MINUTES_PER_DAY = 24 * 60;
const MS_PER_MINUTE = 60_000;

/** A start and an end of the day, each a minute since midnight, in an IANA time zone. */
export interface QuietWindow {
  readonly fromMinute: number;
  readonly toMinute: number;
  readonly timeZone: string;
}

/** A person's quiet hours, on or off, with when they last changed them. */
export interface QuietHours extends QuietWindow {
  readonly fleetId: FleetId;
  readonly shipId: ShipId;
  readonly isOn: boolean;
  readonly changedAt: Date;
}

/** The quiet hours in effect now: since their start and until their end. */
export interface QuietSpell {
  readonly since: Date;
  readonly until: Date;
}

/** Outbound port: each person's quiet hours, by fleet and person ship. */
export interface QuietHoursStore {
  find(ship: PersonShip): Promise<QuietHours | undefined>;
  /** Keeps them, or keeps them anew for the person ship. */
  save(hours: QuietHours): Promise<void>;
}

const isMinuteOfDay = (minute: number): boolean => Number.isInteger(minute) && minute >= 0 && minute < MINUTES_PER_DAY;

function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** A quiet window, refused when either end is not a minute of the day, both ends are one, or the time zone is unknown. */
export function quietWindowOf(window: QuietWindow): Result<QuietWindow, DomainError<'INVALID_QUIET_HOURS'>> {
  const { fromMinute, toMinute, timeZone } = window;
  if (!isMinuteOfDay(fromMinute) || !isMinuteOfDay(toMinute)) {
    return refuse('INVALID_QUIET_HOURS', 'Quiet hours start and end at a time of the day');
  }
  if (fromMinute === toMinute) {
    return refuse('INVALID_QUIET_HOURS', 'Quiet hours end at another time than they start');
  }
  if (!isKnownTimeZone(timeZone)) {
    return refuse('INVALID_QUIET_HOURS', `No time zone is named ${timeZone}`);
  }
  return ok({ fromMinute, toMinute, timeZone });
}

/** The day and minute of the day an instant falls on in the time zone. */
interface LocalTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly minute: number;
}

function localTimeOf(instant: Date, timeZone: string): LocalTime & { readonly asUtcMs: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((each) => each.type === type)?.value);
  const [year, month, day, hour, minute] = [part('year'), part('month'), part('day'), part('hour'), part('minute')];
  return { year, month, day, minute: hour * 60 + minute, asUtcMs: Date.UTC(year, month - 1, day, hour, minute) };
}

/** How far the time zone's clock is ahead of UTC at the instant. */
function offsetMsAt(instantMs: number, timeZone: string): number {
  const floored = Math.floor(instantMs / MS_PER_MINUTE) * MS_PER_MINUTE;
  return localTimeOf(new Date(floored), timeZone).asUtcMs - floored;
}

/** The instant the time zone's clock shows the minute on the day, the day counted from the local day given. */
function instantAt(local: LocalTime, { dayOffset, minute, timeZone }: { dayOffset: number; minute: number; timeZone: string }): Date {
  const asUtcMs = Date.UTC(local.year, local.month - 1, local.day + dayOffset, 0, minute);
  // The offset at a first guess, then at the instant it gives, so a change of the clocks in between is taken.
  const guess = asUtcMs - offsetMsAt(asUtcMs, timeZone);
  return new Date(asUtcMs - offsetMsAt(guess, timeZone));
}

/** The quiet hours in effect at the instant, or none while they are off or the instant is outside them. */
export function quietSpellAt(hours: QuietHours, now: Date): QuietSpell | undefined {
  if (!hours.isOn) {
    return undefined;
  }
  const { fromMinute, toMinute, timeZone } = hours;
  const local = localTimeOf(now, timeZone);
  const isCrossingMidnight = fromMinute > toMinute;
  const isAfterStart = local.minute >= fromMinute;
  const isBeforeEnd = local.minute < toMinute;
  if (isCrossingMidnight ? !isAfterStart && !isBeforeEnd : !isAfterStart || !isBeforeEnd) {
    return undefined;
  }
  // Crossing midnight, a spell began yesterday when it is after midnight now, and ends tomorrow when it is before.
  const startDay = isCrossingMidnight && !isAfterStart ? -1 : 0;
  const endDay = isCrossingMidnight && isAfterStart ? 1 : 0;
  return { since: instantAt(local, { dayOffset: startDay, minute: fromMinute, timeZone }), until: instantAt(local, { dayOffset: endDay, minute: toMinute, timeZone }) };
}
