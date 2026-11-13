import { describe, expect, it } from 'vitest';

import { headerSwitchersOf, switcherOnPage, type AccountApps } from './header-switchers';

const ACME = 'flt_01m5fcd917vwf30mx663fgc3z8';
const LABS = 'flt_01m4ajt7abh4rypkmdnjene67g';

/** Charlotte's list: Account outside any fleet; the gateway and the console in Acme, the console alone in Labs. */
function aList(overrides: Partial<AccountApps> = {}): AccountApps {
  return {
    account: { id: 'acc-charlotte', email: 'charlotte@acme.example' },
    apps: [{ app: 'account', url: 'https://account.example/account' }],
    fleets: [
      { id: ACME, name: 'Acme', apps: [{ app: 'console', url: 'https://fleet.example' }, { app: 'gateway', url: 'https://gateway.example' }] },
      { id: LABS, name: 'Labs', apps: [{ app: 'console', url: 'https://fleet.example' }] },
    ],
    ...overrides,
  };
}

describe("the header's switcher on the gateway's pages (header design H1, H9)", () => {
  it('offers one switcher per listed fleet, each with that fleet in view and the gateway open', () => {
    expect(headerSwitchersOf(aList()).map(({ fleet, appLabel }) => ({ fleet, appLabel }))).toEqual([
      { fleet: { id: ACME, name: 'Acme' }, appLabel: 'Gateway' },
      { fleet: { id: LABS, name: 'Labs' }, appLabel: 'Gateway' },
    ]);
  });

  it("offers the fleet in view's apps in that fleet, then Account, the gateway current", () => {
    const [acme] = headerSwitchersOf(aList());
    expect(acme?.apps.map(({ label, url, isCurrent }) => ({ label, url, isCurrent }))).toEqual([
      { label: 'Console', url: `https://fleet.example/?fleet=${ACME}`, isCurrent: false },
      { label: 'Gateway', url: `https://gateway.example/?fleet=${ACME}`, isCurrent: true },
      { label: 'Account', url: 'https://account.example/account', isCurrent: false },
    ]);
  });

  it('switches fleet to the gateway there, or to the first app the account may open there', () => {
    const [acme] = headerSwitchersOf(aList());
    expect(acme?.fleets.map(({ name, url }) => ({ name, url }))).toEqual([
      { name: 'Acme', url: `https://gateway.example/?fleet=${ACME}` },
      { name: 'Labs', url: `https://fleet.example/?fleet=${LABS}` },
    ]);
  });

  it('leaves out an app the header does not know', () => {
    const [acme] = headerSwitchersOf(aList({ apps: [{ app: 'account', url: 'https://account.example/account' }, { app: 'lighthouse', url: 'https://lighthouse.example' }] }));
    expect(acme?.apps.map(({ label }) => label)).toEqual(['Console', 'Gateway', 'Account']);
  });
});

describe("the header's switcher on an answer it cannot read", () => {
  it('offers no switcher for a malformed fleet id, so the page shows the plain bar', () => {
    expect(headerSwitchersOf(aList({ fleets: [{ id: 'not-a-fleet', name: 'Acme', apps: [] }] }))).toEqual([]);
  });

  it('offers no switcher for a malformed account id, so the page shows the plain bar', () => {
    expect(headerSwitchersOf(aList({ account: { id: '', email: 'charlotte@acme.example' } }))).toEqual([]);
  });
});

/** Charlotte's list with the gateway open in both fleets. */
function aListInBoth(): AccountApps {
  return aList({
    fleets: [
      { id: ACME, name: 'Acme', apps: [{ app: 'console', url: 'https://fleet.example' }, { app: 'gateway', url: 'https://gateway.example' }] },
      { id: LABS, name: 'Labs', apps: [{ app: 'gateway', url: 'https://gateway.example' }] },
    ],
  });
}

describe("the header's switcher on a page of the gateway (header design H9)", () => {
  it.each([
    { page: '/bridge', from: 0, to: { name: 'Labs', url: `https://gateway.example/bridge?fleet=${LABS}` } },
    { page: '/bridge', from: 1, to: { name: 'Acme', url: `https://gateway.example/bridge?fleet=${ACME}` } },
    { page: '/bridge/settings', from: 0, to: { name: 'Labs', url: `https://gateway.example/bridge/settings?fleet=${LABS}` } },
    { page: '/bridge/settings', from: 1, to: { name: 'Acme', url: `https://gateway.example/bridge/settings?fleet=${ACME}` } },
  ])('switches fleet from $page to the same page in $to.name', ({ page, from, to }) => {
    const switcher = headerSwitchersOf(aListInBoth())[from];
    const onPage = switcher === undefined ? undefined : switcherOnPage(switcher, page);
    expect(onPage?.fleets.find(({ name }) => name === to.name)?.url).toBe(to.url);
  });

  it('keeps the fleet in view on the page it shows', () => {
    const [acme] = headerSwitchersOf(aListInBoth());
    const onPage = acme === undefined ? undefined : switcherOnPage(acme, '/bridge/settings');
    expect(onPage?.fleets.find(({ name }) => name === 'Acme')?.url).toBe(`https://gateway.example/bridge/settings?fleet=${ACME}`);
  });

  it('switches to a fleet the gateway does not open in as before: the first app the account may open there', () => {
    const [acme] = headerSwitchersOf(aList());
    const onPage = acme === undefined ? undefined : switcherOnPage(acme, '/bridge/settings');
    expect(onPage?.fleets.find(({ name }) => name === 'Labs')?.url).toBe(`https://fleet.example/?fleet=${LABS}`);
  });

  it('switches to a fleet another gateway opens in at that gateway, as before', () => {
    const [acme] = headerSwitchersOf(aList({
      fleets: [
        { id: ACME, name: 'Acme', apps: [{ app: 'gateway', url: 'https://gateway.example' }] },
        { id: LABS, name: 'Labs', apps: [{ app: 'gateway', url: 'https://labs-gateway.example' }] },
      ],
    }));
    const onPage = acme === undefined ? undefined : switcherOnPage(acme, '/bridge/settings');
    expect(onPage?.fleets.find(({ name }) => name === 'Labs')?.url).toBe(`https://labs-gateway.example/?fleet=${LABS}`);
  });

  it("leaves the fleet in view's apps as they are", () => {
    const [acme] = headerSwitchersOf(aListInBoth());
    const onPage = acme === undefined ? undefined : switcherOnPage(acme, '/bridge/settings');
    expect(onPage?.apps).toEqual(acme?.apps);
  });
});
