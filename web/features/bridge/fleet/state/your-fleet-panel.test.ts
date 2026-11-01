import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { YourFleet } from '../services/your-fleet';
import { FleetPage } from './fleet-page';
import { YourFleetPanel, type PhoneHome } from './your-fleet-panel';

/** Thomas's fleet as home.html draws it, a ship in each state. */
const FLEET: YourFleet = {
  shipCount: 4,
  counts: { alert: 1, waiting: 1, working: 1, idle: 1 },
  groups: [
    { group: 'people', tiles: [{ shipId: 'shp_01m3tbfspe96yf1rnr4ank9arg', name: 'argo', state: 'idle', note: null }] },
    {
      group: 'agents',
      tiles: [
        { shipId: 'shp_01m3tbfspe96yf1rnr4ank9bgw', name: 'builder-gateway', state: 'alert', note: null },
        { shipId: 'shp_01m3tbfspe96yf1rnr4ank9orc', name: 'orchestrator-1', state: 'waiting', note: 'waiting on Thomas' },
      ],
    },
    { group: 'throughTheGateway', tiles: [{ shipId: 'shp_01m3tbfspe96yf1rnr4ank9git', name: 'github', state: 'working', note: 'listing issues' }] },
  ],
};

function panel(read: Parameters<typeof YourFleetPanel>[0]['read'], phone: PhoneHome = 'numbers'): string {
  return renderToStaticMarkup(createElement(YourFleetPanel, { fleetId: 'flt_01', read, phone }));
}

describe('Your fleet beside Bridge home', () => {
  it('heads the panel with the ship count, linking to the whole fleet', () => {
    const markup = panel({ kind: 'read', value: FLEET });

    expect([markup.includes('href="/bridge/fleet?fleet=flt_01"'), markup.includes('>4 ships<')]).toEqual([true, true]);
  });

  it('shows the four numbers, each with its word', () => {
    const markup = panel({ kind: 'read', value: FLEET });

    expect(['alert', 'waiting', 'working', 'idle'].map((state) => markup.includes(`data-testid="fleet-number-${state}"`))).toEqual([true, true, true, true]);
  });

  it('shows a tile per ship in its group, with its state in words', () => {
    const markup = panel({ kind: 'read', value: FLEET });

    expect({
      groups: ['People', 'Agents', 'Through the gateway'].map((group) => markup.includes(`>${group}<`)),
      tiles: (markup.match(/data-testid="fleet-tile"/g) ?? []).length,
      plugins: markup.includes('>Plugins<'),
    }).toEqual({ groups: [true, true, true], tiles: 4, plugins: false });
  });

  it("says on hover what a ship is doing, as its crew last said", () => {
    expect(panel({ kind: 'read', value: FLEET }).includes('title="orchestrator-1: waiting on Thomas"')).toBe(true);
  });

  it('shows the phone only the numbers when nothing waits, and nothing of the fleet while something waits', () => {
    const whenNothingWaits = panel({ kind: 'read', value: FLEET }, 'numbers');
    const whileSomethingWaits = panel({ kind: 'read', value: FLEET }, 'hidden');

    expect([whenNothingWaits.includes('data-testid="fleet-wall" class="max-lg:hidden'), whileSomethingWaits.includes('data-testid="bridge-your-fleet" class="max-lg:hidden')]).toEqual([true, true]);
  });

  it('says so when the fleet cannot be read now, why, and nothing else', () => {
    const markup = panel({ kind: 'unreadable', message: 'The fleet did not list its ships: The fleet did not answer' });

    expect([markup.includes('Your fleet cannot be read now'), markup.includes('The fleet did not answer'), markup.includes('fleet-tile')]).toEqual([true, true, false]);
  });

  it('is left out for an account the fleet does not let read it', () => {
    expect(panel({ kind: 'forbidden' })).toBe('');
  });
});

describe("the phone's Fleet tab", () => {
  it('leads with the summary and five numbers: the ships, then each state', () => {
    const markup = renderToStaticMarkup(createElement(FleetPage, { read: { kind: 'read', value: FLEET } }));

    expect({
      summary: markup.includes('4 ships: 1 working, 1 idle, 1 waiting, 1 with an alert'),
      numbers: ['ships', 'alert', 'waiting', 'working', 'idle'].map((number) => markup.includes(`data-testid="fleet-number-${number}"`)),
      tiles: (markup.match(/data-testid="fleet-tile"/g) ?? []).length,
    }).toEqual({ summary: true, numbers: [true, true, true, true, true], tiles: 4 });
  });

  it('says the account may not read the fleet when the fleet does not let it', () => {
    expect(renderToStaticMarkup(createElement(FleetPage, { read: { kind: 'forbidden' } })).includes('Your account may not read the fleet&#x27;s ships.')).toBe(true);
  });
});
