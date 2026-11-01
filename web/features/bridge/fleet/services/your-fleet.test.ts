import { describe, expect, it } from 'vitest';

import { summaryOf, type YourFleet } from './your-fleet';

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
