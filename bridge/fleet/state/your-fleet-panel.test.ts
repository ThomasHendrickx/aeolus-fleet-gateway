import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { YourFleet } from '../services/your-fleet';
import { FleetPage } from './fleet-page';
import { YourFleetPanel, type PhoneHome } from './your-fleet-panel';

/** Thomas's fleet as the state-colours sheet draws Bridge, a ship in each state. */
const FLEET: YourFleet = {
  shipCount: 5,
  counts: { alert: 1, awaitingCrew: 1, blocked: 1, working: 1, idle: 1 },
  groups: [
    { group: 'people', tiles: [{ shipId: 'shp_01m3tbfspe96yf1rnr4ank9arg', name: 'argo', state: 'idle', note: null, lastActivityAt: null }] },
    {
      group: 'agents',
      tiles: [
        { shipId: 'shp_01m3tbfspe96yf1rnr4ank9bgw', name: 'builder-gateway', state: 'alert', note: null, lastActivityAt: null },
        { shipId: 'shp_01m3tbfspe96yf1rnr4ank9wlk', name: 'walker-3', state: 'awaitingCrew', note: null, lastActivityAt: null },
        { shipId: 'shp_01m3tbfspe96yf1rnr4ank9orc', name: 'orchestrator-1', state: 'blocked', note: 'waiting on Thomas', lastActivityAt: null },
      ],
    },
    { group: 'throughTheGateway', tiles: [{ shipId: 'shp_01m3tbfspe96yf1rnr4ank9git', name: 'github', state: 'working', note: 'listing issues', lastActivityAt: null }] },
  ],
};

const CONSOLE_URL = 'https://console.example';

function panel(read: Parameters<typeof YourFleetPanel>[0]['read'], phone: PhoneHome = 'numbers'): string {
  return renderToStaticMarkup(createElement(YourFleetPanel, { fleetId: 'flt_01', consoleUrl: CONSOLE_URL, read, phone }));
}

function fleetPage(read: Parameters<typeof FleetPage>[0]['read']): string {
  return renderToStaticMarkup(createElement(FleetPage, { consoleUrl: CONSOLE_URL, read }));
}

const SIX_NUMBERS = ['ships', 'alert', 'awaitingCrew', 'blocked', 'working', 'idle'];

describe('Your fleet beside Bridge home, drawn by Harbour from @aeolus-fleet/ui', () => {
  it('heads the panel Your fleet, linking to the whole fleet, with no ship count beside it: Harbour leads with the ships', () => {
    const markup = panel({ kind: 'read', value: FLEET });

    expect([markup.includes('href="/bridge/fleet?fleet=flt_01"'), markup.includes('5 ships')]).toEqual([true, false]);
  });

  it("shows Harbour's six numbers, the ships then each of the five states", () => {
    const markup = panel({ kind: 'read', value: FLEET });

    expect(SIX_NUMBERS.map((number) => markup.includes(`data-testid="harbour-number-${number}"`))).toEqual([true, true, true, true, true, true]);
  });

  it('shows a tile per ship in its group, each in its state', () => {
    const markup = panel({ kind: 'read', value: FLEET });

    expect({
      groups: ['people', 'agents', 'gateway'].map((kind) => markup.includes(`data-testid="harbour-group-${kind}"`)),
      plugins: markup.includes('data-testid="harbour-group-plugins"'),
      states: [...markup.matchAll(/data-testid="harbour-tile" data-state="(\w+)"/g)].map(([, state]) => state),
    }).toEqual({ groups: [true, true, true], plugins: false, states: ['idle', 'alert', 'awaitingCrew', 'blocked', 'working'] });
  });

  it("opens a tile's ship in the fleet's console", () => {
    expect(panel({ kind: 'read', value: FLEET }).includes('href="https://console.example/ships/shp_01m3tbfspe96yf1rnr4ank9orc"')).toBe(true);
  });

  it("rings a tile focused by keyboard with the design system's focus outline, which the part's outline-none would otherwise hide (review of #276)", () => {
    const tile = /<a[^>]*data-testid="harbour-tile"[^>]*>/.exec(panel({ kind: 'read', value: FLEET }))?.[0] ?? '';

    expect(['focus-visible:outline-solid', 'focus-visible:outline-2', 'focus-visible:outline-ring'].map((name) => tile.split(/[ "]/).includes(name))).toEqual([true, true, true]);
  });

  it('hides the arrow on a pressed tile, as the mockup draws it (review of #276)', () => {
    const tile = /<a[^>]*data-testid="harbour-tile"[^>]*>/.exec(panel({ kind: 'read', value: FLEET }))?.[0] ?? '';

    expect(tile.replaceAll('&amp;', '&').replaceAll('&gt;', '>').split(/[ "]/).includes('[&:active>span.absolute]:opacity-0')).toBe(true);
  });

  it('draws tiles that are not links while the console is not known', () => {
    const markup = renderToStaticMarkup(createElement(YourFleetPanel, { fleetId: 'flt_01', consoleUrl: undefined, read: { kind: 'read', value: FLEET }, phone: 'numbers' }));

    expect([markup.includes('data-testid="harbour-tile"'), markup.includes('/ships/')]).toEqual([true, false]);
  });

  it('shows the phone only the numbers when nothing waits, and nothing of the fleet while something waits', () => {
    const whenNothingWaits = panel({ kind: 'read', value: FLEET }, 'numbers');
    const whileSomethingWaits = panel({ kind: 'read', value: FLEET }, 'hidden');

    expect([
      whenNothingWaits.includes('<div class="lg:hidden"><div class="@container min-w-0" data-testid="harbour-numbers"'),
      whenNothingWaits.includes('<div class="max-lg:hidden"><section aria-label="Harbour"'),
      whileSomethingWaits.includes('data-testid="bridge-your-fleet" class="max-lg:hidden'),
    ]).toEqual([true, true, true]);
  });

  it('says so when the fleet cannot be read now, why, and nothing else', () => {
    const markup = panel({ kind: 'unreadable', message: 'The fleet did not list its ships: The fleet did not answer' });

    expect([markup.includes('Your fleet cannot be read now'), markup.includes('The fleet did not answer'), markup.includes('harbour')]).toEqual([true, true, false]);
  });

  it('is left out for an account the fleet does not let read it', () => {
    expect(panel({ kind: 'forbidden' })).toBe('');
  });
});

describe("the phone's Fleet tab, drawn by Harbour from @aeolus-fleet/ui", () => {
  it("leaves the heading to the phone's top bar, straight to the numbers; Your fleet on a wider screen, with no lead line: Harbour's numbers say it (Thomas, 5 Nov)", () => {
    const markup = fleetPage({ kind: 'read', value: FLEET });

    expect([/<div class="max-sm:sr-only"><h1[^>]*>Your fleet<\/h1><\/div>/.test(markup), markup.includes('5 ships')]).toEqual([true, false]);
  });

  it("shows Harbour's six numbers and a tile per ship", () => {
    const markup = fleetPage({ kind: 'read', value: FLEET });

    expect({
      numbers: SIX_NUMBERS.map((number) => markup.includes(`data-testid="harbour-number-${number}"`)),
      tiles: (markup.match(/data-testid="harbour-tile"/g) ?? []).length,
    }).toEqual({ numbers: [true, true, true, true, true, true], tiles: 5 });
  });

  it('says the account may not read the fleet when the fleet does not let it', () => {
    expect(fleetPage({ kind: 'forbidden' }).includes('Your account may not read the fleet&#x27;s ships.')).toBe(true);
  });
});

describe('Your fleet while the record cannot be read either (states.html)', () => {
  it("shows nothing of its own, so the banner alone says it, once and without core's words", () => {
    const markup = renderToStaticMarkup(createElement(YourFleetPanel, { fleetId: 'flt_01', consoleUrl: undefined, read: { kind: 'unreadable', message: 'The fleet did not answer: fetch failed' }, phone: 'hidden', isRecordUnreadable: true }));

    expect(markup).toBe('');
  });
});
