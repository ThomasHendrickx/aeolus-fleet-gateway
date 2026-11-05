import { describe, expect, it } from 'vitest';

import { yourFleetOf, type ListedShip } from './your-fleet.js';

// Your fleet (Bridge home, as Harbour draws it, docs/design/fleet-overview):
// each ship in one of five states, as core words them (docs/design/state-colours), and in one
// group by its kind: People, Agents, Plugins, Through the gateway.

let next = 0;

function aShip(overrides: Partial<ListedShip>): ListedShip {
  next += 1;
  return { shipId: `shp_01m3tbfspe96yf1rnr4ank9c${String(next).padStart(2, '0')}`, name: `ship-${String(next)}`, kind: 'agent', state: 'idle', note: null, lastActivityAt: null, ...overrides };
}

function tileOf(ship: ListedShip) {
  return yourFleetOf([ship]).groups[0]?.tiles[0];
}

describe("a ship's tile in your fleet", () => {
  it("carries the state core worded, the crew's note and when the ship last did something", () => {
    const ship = aShip({ name: 'reviewer', state: 'working', note: 'building slice 3', lastActivityAt: '2026-11-01T12:00:00.000Z' });

    expect(tileOf(ship)).toEqual({ shipId: ship.shipId, name: 'reviewer', state: 'working', note: 'building slice 3', lastActivityAt: '2026-11-01T12:00:00.000Z' });
  });

  it('carries no time while the ship did nothing yet', () => {
    expect(tileOf(aShip({ lastActivityAt: null }))?.lastActivityAt).toBeNull();
  });
});

describe('the groups of your fleet', () => {
  it('puts argo and person ships in People, agents in Agents, plugins in Plugins and app ships Through the gateway, in that order', () => {
    const fleet = yourFleetOf([aShip({ name: 'github', kind: 'app' }), aShip({ name: 'watch', kind: 'plugin' }), aShip({ name: 'reviewer', kind: 'agent' }), aShip({ name: 'ada', kind: 'person' }), aShip({ name: 'argo', kind: 'operator' })]);

    expect(fleet.groups.map(({ group, tiles }) => [group, tiles.map(({ name }) => name)])).toEqual([
      ['people', ['ada', 'argo']],
      ['agents', ['reviewer']],
      ['plugins', ['watch']],
      ['throughTheGateway', ['github']],
    ]);
  });

  it("leaves the viewer, the console's door, out", () => {
    const fleet = yourFleetOf([aShip({ name: 'console', kind: 'viewer' }), aShip({ name: 'reviewer' })]);

    expect([fleet.shipCount, fleet.groups.flatMap(({ tiles }) => tiles.map(({ name }) => name))]).toEqual([1, ['reviewer']]);
  });

  it('shows no group that holds no ship', () => {
    expect(yourFleetOf([aShip({ kind: 'agent' })]).groups.map(({ group }) => group)).toEqual(['agents']);
  });

  it('orders each group alerts first, then awaiting crew, blocked, working and idle', () => {
    const fleet = yourFleetOf([
      aShip({ name: 'walker-1', state: 'idle' }),
      aShip({ name: 'reviewer', state: 'working' }),
      aShip({ name: 'orchestrator-1', state: 'blocked' }),
      aShip({ name: 'walker-3', state: 'awaitingCrew' }),
      aShip({ name: 'builder-gateway', state: 'alert' }),
    ]);

    expect(fleet.groups[0]?.tiles.map(({ name }) => name)).toEqual(['builder-gateway', 'walker-3', 'orchestrator-1', 'reviewer', 'walker-1']);
  });

  it('orders ships in one state by their last activity, newest first, and a ship that never did anything last (Thomas, aeolus-fleet#1605)', () => {
    const fleet = yourFleetOf([
      aShip({ name: 'aeolus-guide', state: 'working', lastActivityAt: null }),
      aShip({ name: 'builder-core', state: 'working', lastActivityAt: '2026-11-01T11:00:00.000Z' }),
      aShip({ name: 'reviewer', state: 'working', lastActivityAt: '2026-11-01T12:00:00.000Z' }),
    ]);

    expect(fleet.groups[0]?.tiles.map(({ name }) => name)).toEqual(['reviewer', 'builder-core', 'aeolus-guide']);
  });

  it('orders ships in one state with the same last activity by name', () => {
    const fleet = yourFleetOf([
      aShip({ name: 'walker-2', state: 'idle', lastActivityAt: '2026-11-01T12:00:00.000Z' }),
      aShip({ name: 'walker-1', state: 'idle', lastActivityAt: '2026-11-01T12:00:00.000Z' }),
      aShip({ name: 'scout-2', state: 'idle', lastActivityAt: null }),
      aShip({ name: 'scout-1', state: 'idle', lastActivityAt: null }),
    ]);

    expect(fleet.groups[0]?.tiles.map(({ name }) => name)).toEqual(['walker-1', 'walker-2', 'scout-1', 'scout-2']);
  });
});

describe('the numbers of your fleet', () => {
  it('counts the ships, and how many are in each state', () => {
    const fleet = yourFleetOf([
      aShip({ state: 'alert' }),
      aShip({ state: 'awaitingCrew' }),
      aShip({ state: 'awaitingCrew' }),
      aShip({ state: 'blocked' }),
      aShip({ kind: 'plugin', state: 'working' }),
      aShip({ kind: 'person' }),
    ]);

    expect([fleet.shipCount, fleet.counts]).toEqual([6, { alert: 1, awaitingCrew: 2, blocked: 1, working: 1, idle: 1 }]);
  });

  it("counts a viewer's alert too, so the numbers are the ones core counts and the sidebar shows", () => {
    const fleet = yourFleetOf([aShip({ name: 'console', kind: 'viewer', state: 'alert' }), aShip({ name: 'reviewer', state: 'alert' })]);

    expect([fleet.shipCount, fleet.counts.alert]).toEqual([1, 2]);
  });

  it('counts nothing in a fleet with no ships', () => {
    expect(yourFleetOf([])).toEqual({ shipCount: 0, counts: { alert: 0, awaitingCrew: 0, blocked: 0, working: 0, idle: 0 }, groups: [] });
  });
});
