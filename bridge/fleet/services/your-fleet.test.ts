import { describe, expect, it } from 'vitest';

import { harbourOf, type YourFleet } from './your-fleet';

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
