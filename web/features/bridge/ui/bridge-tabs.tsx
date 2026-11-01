import { Bell, CheckCheck, Inbox, Ship, ShoppingBasket, type LucideIcon } from 'lucide-react';

import { inFleet } from '../../../lib/gateway-api/page-account';
import { BRIDGE_BASKET_PATH, BRIDGE_DONE_PATH, BRIDGE_FLEET_PATH, BRIDGE_PATH, BRIDGE_STAY_AWARE_PATH } from '../paths';
import { screenOf, type BridgeScreen, type PhoneTab } from '../services/shell';
import type { ShellCounts } from './bridge-sidebar';
import { ShellCount, type CountTone } from './shell-count';

interface Tab {
  readonly key: PhoneTab;
  readonly label: string;
  readonly path: string;
  readonly Icon: LucideIcon;
  readonly count?: { readonly value: number | undefined; readonly tone: CountTone };
}

/** The basket as a bar above the tabs (basket.html; aeolus-fleet#1515): its count, not sent, and the way to it. */
function BasketBar({ fleetId, count }: { fleetId: string; count: number }) {
  return (
    <div data-testid="bridge-basket-bar" className="flex items-center gap-2.5 border-t border-border bg-highlight px-3.5 py-2">
      <ShoppingBasket aria-hidden className="size-4 text-primary" />
      <span>
        <b className="font-semibold">Basket {count}</b> <span className="text-muted-foreground">not sent</span>
      </span>
      <a href={inFleet(BRIDGE_BASKET_PATH, fleetId)} className="ml-auto inline-flex h-8 items-center rounded-md bg-primary px-3 font-medium text-primary-foreground hover:bg-primary-hover">
        Open
      </a>
    </div>
  );
}

/**
 * The phone's foot (home.html): the basket as a bar while it holds any,
 * except on the basket itself, above four tabs: Waiting, Aware, Done and
 * Fleet, each with its count, the tab the page in view is under current.
 */
export function BridgeTabs({ fleetId, screen, counts }: { fleetId: string; screen: BridgeScreen; counts: ShellCounts }) {
  const { tab: current } = screenOf(screen);
  const tabs: Tab[] = [
    { key: 'waiting', label: 'Waiting', path: BRIDGE_PATH, Icon: Inbox, count: { value: counts.waiting, tone: 'waiting' } },
    { key: 'aware', label: 'Aware', path: BRIDGE_STAY_AWARE_PATH, Icon: Bell, count: { value: counts.stayAware, tone: 'plain' } },
    { key: 'done', label: 'Done', path: BRIDGE_DONE_PATH, Icon: CheckCheck },
    { key: 'fleet', label: 'Fleet', path: BRIDGE_FLEET_PATH, Icon: Ship, count: { value: counts.fleetAlerts, tone: 'attention' } },
  ];
  return (
    <div className="sticky bottom-0 z-30 bg-background sm:hidden">
      {counts.basket > 0 && screen !== 'basket' ? <BasketBar fleetId={fleetId} count={counts.basket} /> : null}
      <nav aria-label="Bridge" className="flex h-(--size-tabbar) border-t border-border pb-3">
        {tabs.map(({ key, label, path, Icon, count }) => (
          <a
            key={key}
            href={inFleet(path, fleetId)}
            data-testid={`bridge-tab-${key}`}
            aria-current={key === current ? 'page' : undefined}
            className={`relative flex flex-1 flex-col items-center justify-center gap-1 text-micro font-medium ${key === current ? 'text-primary' : 'text-muted-foreground'}`}
          >
            <Icon aria-hidden className="size-(--size-icon-tab)" />
            {label}
            {count === undefined ? null : <ShellCount count={count.value} tone={count.tone} className="absolute top-1 left-[calc(50%+6px)] h-4 min-w-4 text-[10px]" />}
          </a>
        ))}
      </nav>
    </div>
  );
}
