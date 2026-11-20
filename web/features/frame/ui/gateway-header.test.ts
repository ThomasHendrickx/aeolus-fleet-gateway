import type { AppSwitcherModel } from '@aeolus-fleet/common/rules';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { GatewayHeader } from './gateway-header';
import { PageSwitcher } from './page-switcher';

// Next's navigation is the browser boundary; these parts receive the current page from it.
vi.mock('next/navigation', () => ({ usePathname: () => '/bridge', useSearchParams: () => new URLSearchParams() }));

const SWITCHER: AppSwitcherModel = {
  fleet: { id: 'flt_01m5fcd917vwf30mx663fgc3z8', name: 'Acme' },
  appLabel: 'Gateway',
  apps: [],
  fleets: [],
};

describe('the gateway uses the shared switcher at each screen size', () => {
  it('offers a sheet from the phone launcher', () => {
    const html = renderToStaticMarkup(createElement(GatewayHeader, { switchers: [SWITCHER], email: 'charlotte@example.com', accountUrl: undefined, theme: { theme: 'system', cookieDomain: undefined } }));
    const phone = html.slice(html.lastIndexOf('<header'));
    expect(phone).toMatch(/<button(?=[^>]*data-testid="app-switcher-launcher")(?=[^>]*aria-haspopup="dialog")[^>]*>/);
  });

  it('offers a menu from the page title launcher', () => {
    const html = renderToStaticMarkup(createElement(PageSwitcher, { switcher: SWITCHER }));
    expect(html).toMatch(/<button(?=[^>]*data-testid="app-switcher-launcher")(?=[^>]*aria-haspopup="menu")[^>]*>/);
  });
});
