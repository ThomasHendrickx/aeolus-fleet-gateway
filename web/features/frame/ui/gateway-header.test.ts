import type { AppSwitcherModel } from '@aeolus-fleet/common/rules';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GatewayHeader } from './gateway-header';
import { PageSwitcher } from './page-switcher';

// Supply the current page through Next's navigation contexts as the app does.
function renderOnBridge(element: ReactElement): string {
  return renderToStaticMarkup(createElement(PathnameContext.Provider, { value: '/bridge' }, createElement(SearchParamsContext.Provider, { value: new URLSearchParams() }, element)));
}

const SWITCHER: AppSwitcherModel = {
  fleet: { id: 'flt_01m5fcd917vwf30mx663fgc3z8', name: 'Acme' },
  appLabel: 'Gateway',
  canSwitch: true,
  apps: [],
  fleets: [],
};

describe('the gateway uses the shared switcher at each screen size', () => {
  it('offers a sheet from the phone launcher', () => {
    const html = renderOnBridge(createElement(GatewayHeader, { switchers: [SWITCHER], email: 'charlotte@example.com', accountUrl: undefined, theme: { theme: 'system', cookieDomain: undefined } }));
    const phone = html.slice(html.lastIndexOf('<header'));
    expect(phone).toMatch(/<button(?=[^>]*data-testid="app-switcher-launcher")(?=[^>]*aria-haspopup="dialog")[^>]*>/);
  });

  it('offers a menu from the page title launcher', () => {
    const html = renderOnBridge(createElement(PageSwitcher, { switcher: SWITCHER }));
    expect(html).toMatch(/<button(?=[^>]*data-testid="app-switcher-launcher")(?=[^>]*aria-haspopup="menu")[^>]*>/);
  });
});
