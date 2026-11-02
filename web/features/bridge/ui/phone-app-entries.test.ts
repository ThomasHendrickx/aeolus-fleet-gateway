import { describe, expect, it } from 'vitest';

import { headerSwitchersOf } from '../../frame/services/header-switchers';
import { phoneAppEntries } from './phone-app-entries';

const FLEET = 'flt_01m5fcd917vwf30mx663fgc3z8';

describe("Bridge's phone app navigation", () => {
  it('offers each permitted app in the avatar sheet with the fleet retained', () => {
    const [switcher] = headerSwitchersOf({
      account: { id: 'acc-thomas', email: 'thomas@example.com' },
      apps: [{ app: 'account', url: 'https://account.example/' }, { app: 'admin', url: 'https://account.example/admin' }],
      fleets: [{ id: FLEET, name: 'Aeolus fleet', apps: [{ app: 'console', url: 'https://console.example/' }, { app: 'gateway', url: 'https://bridge.example/' }] }],
    });
    expect(phoneAppEntries(switcher).map(({ label, href, isPhoneOnly }) => ({ label, href, isPhoneOnly }))).toEqual([
      { label: 'Console', href: `https://console.example/?fleet=${FLEET}`, isPhoneOnly: true },
      { label: 'Gateway', href: `https://bridge.example/?fleet=${FLEET}`, isPhoneOnly: true },
      { label: 'Account', href: 'https://account.example/', isPhoneOnly: true },
      { label: 'Admin', href: 'https://account.example/admin', isPhoneOnly: true },
    ]);
  });

  it('offers no apps while the account cannot be read', () => {
    expect(phoneAppEntries(undefined)).toEqual([]);
  });
});
