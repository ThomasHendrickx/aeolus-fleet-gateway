import { describe, expect, it } from 'vitest';

import { harbourOf, summaryOf, type YourFleet } from './your-fleet';

function aFleet(counts: YourFleet['counts']): YourFleet {
  return { shipCount: counts.alert + counts.awaitingCrew + counts.blocked + counts.working + counts.idle, counts, groups: [] };
}

// Harbour's lead line: the ships, then how many work, idle, await crew, are blocked and have an alert.
describe("Your fleet's summary", () => {
  it('names the ships and each state they are in', () => {
    expect(summaryOf(aFleet({ alert: 1, awaitingCrew: 2, blocked: 1, working: 8, idle: 7 }))).toBe('19 ships: 8 working, 7 idle, 2 awaiting crew, 1 blocked, 1 with an alert');
  });

  it('leaves out a state no ship is in', () => {
    expect(summaryOf(aFleet({ alert: 0, awaitingCrew: 0, blocked: 0, working: 3, idle: 1 }))).toBe('4 ships: 3 working, 1 idle');
  });

  it('says one ship as one', () => {
    expect(summaryOf(aFleet({ alert: 0, awaitingCrew: 0, blocked: 0, working: 0, idle: 1 }))).toBe('1 ship: 1 idle');
  });

  it('says so when the person reads no ship', () => {
    expect(summaryOf(aFleet({ alert: 0, awaitingCrew: 0, blocked: 0, working: 0, idle: 0 }))).toBe('No ships');
  });
});

// Harbour in @aeolus-fleet/ui draws Your fleet: its numbers lead with the ships, its groups name their kind, its tiles their ship.
describe('Your fleet as Harbour draws it', () => {
  const FLEET: YourFleet = {
    shipCount: 2,
    counts: { alert: 0, awaitingCrew: 1, blocked: 0, working: 1, idle: 0 },
    groups: [
      { group: 'agents', tiles: [{ shipId: 'shp_01m3tbfspe96yf1rnr4ank9rev', name: 'reviewer', state: 'working', note: 'reviewing #231', lastActivityAt: '2026-11-05T12:00:00.000Z' }] },
      { group: 'throughTheGateway', tiles: [{ shipId: 'shp_01m3tbfspe96yf1rnr4ank9git', name: 'github', state: 'awaitingCrew', note: null, lastActivityAt: null }] },
    ],
  };

  it('counts the ships first, then each of the five states', () => {
    expect(harbourOf(FLEET).counts).toEqual({ ships: 2, alert: 0, awaitingCrew: 1, blocked: 0, working: 1, idle: 0 });
  });

  it('puts each tile in its kind of group, in the order Your fleet gives', () => {
    expect(harbourOf(FLEET).groups).toEqual([
      { kind: 'agents', tiles: [{ id: 'shp_01m3tbfspe96yf1rnr4ank9rev', name: 'reviewer', state: 'working', note: 'reviewing #231', lastActivityAt: '2026-11-05T12:00:00.000Z' }] },
      { kind: 'gateway', tiles: [{ id: 'shp_01m3tbfspe96yf1rnr4ank9git', name: 'github', state: 'awaitingCrew', note: null, lastActivityAt: null }] },
    ]);
  });
});
