import { describe, expect, it } from 'vitest';

import { yourFleetOf, type ListedShip } from './your-fleet.js';

// Your fleet (Bridge home, as Harbour draws it, docs/design/fleet-overview):
// each ship in one of four states, Alert, Waiting, Working or Idle, and in one
// group by its kind: People, Agents, Plugins, Through the gateway.

let next = 0;

function aShip(overrides: Partial<ListedShip>): ListedShip {
  next += 1;
  return { shipId: `shp_01m3tbfspe96yf1rnr4ank9c${String(next).padStart(2, '0')}`, name: `ship-${String(next)}`, kind: 'agent', status: 'crewed', report: null, openAlertCount: 0, ...overrides };
}

function stateOf(ship: ListedShip): string | undefined {
  return yourFleetOf([ship]).groups[0]?.tiles[0]?.state;
}

describe("a ship's state in your fleet", () => {
  it('is Alert while it has an open alert, whatever its report says', () => {
    expect(stateOf(aShip({ openAlertCount: 1, report: { state: 'working', note: null } }))).toBe('alert');
  });

  it('is Waiting while it awaits crew', () => {
    expect(stateOf(aShip({ status: 'awaitingCrew' }))).toBe('waiting');
  });

  it('is Waiting while its crew reports it is blocked', () => {
    expect(stateOf(aShip({ report: { state: 'blocked', note: 'needs a decision' } }))).toBe('waiting');
  });

  it('is Working while its crew reports working', () => {
    expect(stateOf(aShip({ report: { state: 'working', note: null } }))).toBe('working');
  });

  it('is Idle while its crew reports idle', () => {
    expect(stateOf(aShip({ report: { state: 'idle', note: null } }))).toBe('idle');
  });

  it('is Idle while its crew has reported nothing', () => {
    expect(stateOf(aShip({ report: null }))).toBe('idle');
  });

  it("carries the crew's note, so the tile can say what the ship is doing", () => {
    expect(yourFleetOf([aShip({ report: { state: 'working', note: 'building slice 3' } })]).groups[0]?.tiles[0]?.note).toBe('building slice 3');
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

  it('orders each group alerts first, then waiting, working and idle, ties by name', () => {
    const fleet = yourFleetOf([
      aShip({ name: 'walker-1', report: { state: 'idle', note: null } }),
      aShip({ name: 'reviewer', report: { state: 'working', note: null } }),
      aShip({ name: 'builder-core', report: { state: 'working', note: null } }),
      aShip({ name: 'orchestrator-1', report: { state: 'blocked', note: null } }),
      aShip({ name: 'builder-gateway', openAlertCount: 2 }),
    ]);

    expect(fleet.groups[0]?.tiles.map(({ name }) => name)).toEqual(['builder-gateway', 'orchestrator-1', 'builder-core', 'reviewer', 'walker-1']);
  });
});

describe('the numbers of your fleet', () => {
  it('counts the ships, and how many are in each state', () => {
    const fleet = yourFleetOf([
      aShip({ openAlertCount: 1 }),
      aShip({ status: 'awaitingCrew' }),
      aShip({ report: { state: 'blocked', note: null } }),
      aShip({ kind: 'plugin', report: { state: 'working', note: null } }),
      aShip({ kind: 'person' }),
    ]);

    expect([fleet.shipCount, fleet.counts]).toEqual([5, { alert: 1, waiting: 2, working: 1, idle: 1 }]);
  });

  it('counts nothing in a fleet with no ships', () => {
    expect(yourFleetOf([])).toEqual({ shipCount: 0, counts: { alert: 0, waiting: 0, working: 0, idle: 0 }, groups: [] });
  });
});
