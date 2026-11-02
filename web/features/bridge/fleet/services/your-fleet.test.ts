import { describe, expect, it } from 'vitest';

import { ageOf, summaryOf, type YourFleet } from './your-fleet';

function aFleet(counts: YourFleet['counts']): YourFleet {
  return { shipCount: counts.alert + counts.waiting + counts.working + counts.idle, counts, groups: [] };
}

// Harbour's lead line: the ships, then how many work, idle, wait and have an alert.
describe("Your fleet's summary", () => {
  it('names the ships and each state they are in, as Harbour words it', () => {
    expect(summaryOf(aFleet({ alert: 2, waiting: 2, working: 7, idle: 4 }))).toBe('15 ships: 7 working, 4 idle, 2 waiting, 2 with an alert');
  });

  it('leaves out a state no ship is in', () => {
    expect(summaryOf(aFleet({ alert: 0, waiting: 0, working: 3, idle: 1 }))).toBe('4 ships: 3 working, 1 idle');
  });

  it('says one ship as one', () => {
    expect(summaryOf(aFleet({ alert: 0, waiting: 0, working: 0, idle: 1 }))).toBe('1 ship: 1 idle');
  });

  it('says so when the person reads no ship', () => {
    expect(summaryOf(aFleet({ alert: 0, waiting: 0, working: 0, idle: 0 }))).toBe('No ships');
  });
});

// A tile's last activity in the words the approved mockups draw (design/bridge-fleet-width): now, 25 min, 3 h, yesterday, 2 d, then the date (28 Oct) from a week on.
describe("a ship tile's last activity", () => {
  const NOW = new Date('2026-11-02T12:00:00.000Z');
  const agoOf = (minutes: number) => ageOf(new Date(NOW.getTime() - minutes * 60_000).toISOString(), NOW);

  it('says now within the first minute', () => {
    expect([agoOf(0), agoOf(0.9)]).toEqual(['now', 'now']);
  });

  it('counts whole minutes up to the hour', () => {
    expect([agoOf(1), agoOf(25), agoOf(59)]).toEqual(['1 min', '25 min', '59 min']);
  });

  it('counts whole hours up to a day', () => {
    expect([agoOf(60), agoOf(3 * 60 + 40), agoOf(23 * 60 + 59)]).toEqual(['1 h', '3 h', '23 h']);
  });

  it('says yesterday for the day after', () => {
    expect([agoOf(24 * 60), agoOf(47 * 60 + 59)]).toEqual(['yesterday', 'yesterday']);
  });

  it('counts whole days from two days up to six', () => {
    expect([agoOf(48 * 60), agoOf(6 * 24 * 60 + 23 * 60)]).toEqual(['2 d', '6 d']);
  });

  it('gives the date from a week on', () => {
    expect([agoOf(7 * 24 * 60), agoOf(5 * 7 * 24 * 60)]).toEqual(['26 Oct', '28 Sep']);
  });

  it('says now for a time a little ahead of the clock', () => {
    expect(agoOf(-2)).toBe('now');
  });

  it('says there is no activity while the ship did nothing yet', () => {
    expect(ageOf(null, NOW)).toBe('No activity yet');
  });
});
