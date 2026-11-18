/// <reference types="next" />
import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import type { ReactNode } from 'react';

import '../../../web/app/globals.css';
import { BridgeSidebar } from '../../../web/features/bridge/ui/bridge-sidebar';
import { BridgeTopBar } from '../../../web/features/bridge/ui/bridge-top-bar';
import { BridgeTabs } from '../../../web/features/bridge/ui/bridge-tabs';
import { HomeColumns } from '../../../web/features/bridge/ui/home-columns';
import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { RecordUnreadable } from './record-unreadable';
import { Disconnected } from '../ui/disconnected';

const ROUTER: AppRouterInstance = { back: () => undefined, forward: () => undefined, refresh: () => undefined, push: () => undefined, replace: () => undefined, prefetch: () => undefined, bfcacheId: 'evidence' };

const FLEET = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const COUNTS = { waiting: undefined, stayAware: undefined, messages: undefined, basket: 0, fleetAlerts: undefined };
function Frame({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh"><BridgeSidebar fleetId={FLEET} screen="home" counts={COUNTS} accountUrl={undefined} foot={null} /><div className="flex min-w-0 flex-1 flex-col"><BridgeTopBar fleetId={FLEET} fleetName="Example" screen="home" isLive={false} opened={undefined} phoneAction={null} avatar={null} /><main className="w-full min-w-0 flex-1 px-4 py-5 sm:px-6"><HomeColumns banner={children} main={null} aside={null} /></main><BridgeTabs fleetId={FLEET} screen="home" counts={COUNTS} /></div></div>;
}

describe('M14 recovery evidence from the real Bridge parts', () => {
  for (const width of [375, 1440, 1920]) {
    it(`fits at ${width}`, async () => {
      await page.viewport(width, 1000);
      const screen = await render(<AppRouterContext.Provider value={ROUTER}><Frame><RecordUnreadable whoDidNotAnswer="fleet" /></Frame></AppRouterContext.Provider>);
      await screen.rerender(<Frame><Disconnected isRetrying={false} onRetry={() => undefined} /></Frame>);
      await expect.element(page.getByText('The gateway is not connected to your fleet', { exact: true })).toBeVisible();
      expect(document.documentElement.scrollWidth).toBe(width);
    });
  }
});
