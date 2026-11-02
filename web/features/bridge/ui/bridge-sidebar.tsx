import type { AppSwitcherModel } from '@aeolus-fleet/common/rules';
import { AppSwitcher } from '@aeolus-fleet/ui';
import { Bell, CheckCheck, Globe, Inbox, Route, Ship, ShoppingBasket, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { inFleet } from '../../../lib/gateway-api/page-account';
import { OUTSIDE_PARTIES_PATH } from '../../outside-parties/paths';
import { BRIDGE_FLEET_PATH } from '../fleet/paths';
import { BRIDGE_BASKET_PATH, BRIDGE_DONE_PATH, BRIDGE_PATH, BRIDGE_ROUTING_PATH, BRIDGE_SETTINGS_PATH, BRIDGE_STAY_AWARE_PATH } from '../paths';
import type { BridgeScreen, ShellCounts } from '../services/shell';

export type { ShellCounts };
import { ShellCount, type CountTone } from './shell-count';


interface Entry {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  readonly Icon: LucideIcon;
  readonly isCurrent: boolean;
  readonly count?: { readonly value: number | undefined; readonly tone: CountTone };
}

function SidebarEntry({ entry }: { entry: Entry }) {
  const { key, label, href, Icon, isCurrent, count } = entry;
  return (
    <a
      href={href}
      data-testid={`bridge-side-${key}`}
      aria-current={isCurrent ? 'page' : undefined}
      className={`flex h-[30px] items-center gap-2.5 rounded-md px-2.5 text-foreground ${isCurrent ? 'bg-accent font-medium [&>svg]:text-primary' : 'hover:bg-accent'}`}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      {label}
      {count === undefined ? null : <ShellCount count={count.value} tone={count.tone} className="ml-auto" />}
    </a>
  );
}

/**
 * Bridge's sidebar on desktop: the shared app menu in place of the Bridge mark; Waiting on you,
 * the basket while it holds any (section 9, rule 2), Stay aware, Done and
 * Your fleet, each with its count; the settings: Where things show, the
 * outside parties, and Fleets and account, the account page in the account
 * app; the person at the foot.
 */
export function BridgeSidebar({ fleetId, screen, counts, accountUrl, foot, switcher }: { fleetId: string; screen: BridgeScreen; counts: ShellCounts; accountUrl: string | undefined; foot: ReactNode; switcher?: AppSwitcherModel }) {
  const entry = (key: BridgeScreen, rest: Omit<Entry, 'key' | 'isCurrent'>): Entry => ({ key, isCurrent: key === screen, ...rest });
  const pages: Entry[] = [
    entry('home', { label: 'Waiting on you', href: inFleet(BRIDGE_PATH, fleetId), Icon: Inbox, count: { value: counts.waiting, tone: 'waiting' } }),
    ...(counts.basket > 0 || screen === 'basket' ? [entry('basket', { label: 'Basket', href: inFleet(BRIDGE_BASKET_PATH, fleetId), Icon: ShoppingBasket, count: { value: counts.basket, tone: 'basket' } })] : []),
    entry('stay-aware', { label: 'Stay aware', href: inFleet(BRIDGE_STAY_AWARE_PATH, fleetId), Icon: Bell, count: { value: counts.stayAware, tone: 'plain' } }),
    entry('done', { label: 'Done', href: inFleet(BRIDGE_DONE_PATH, fleetId), Icon: CheckCheck }),
    entry('fleet', { label: 'Your fleet', href: inFleet(BRIDGE_FLEET_PATH, fleetId), Icon: Ship, count: { value: counts.fleetAlerts, tone: 'attention' } }),
  ];
  const settings: Entry[] = [
    entry('routing', { label: 'Where things show', href: inFleet(BRIDGE_ROUTING_PATH, fleetId), Icon: Route }),
    { key: 'outside-parties', label: 'Outside parties', href: inFleet(OUTSIDE_PARTIES_PATH, fleetId), Icon: Globe, isCurrent: false },
    ...(accountUrl === undefined ? [] : [{ key: 'account', label: 'Fleets and account', href: accountUrl, Icon: SlidersHorizontal, isCurrent: false }]),
  ];
  return (
    <aside data-testid="bridge-sidebar" className="sticky top-0 flex h-dvh w-(--size-sidebar) shrink-0 flex-col gap-0.5 border-r border-border bg-sidebar p-3 text-sidebar-foreground max-sm:hidden">
      <div className="mb-2.5 flex h-10 min-w-0 items-center font-semibold">
        {switcher === undefined ? (
          <span className="flex items-center gap-2.5 px-2">
            <span className="inline-flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Ship aria-hidden className="size-4" />
            </span>
            Bridge
          </span>
        ) : <AppSwitcher switcher={switcher} layout="full" className="min-w-0" />}
      </div>
      <nav aria-label="Bridge" className="flex flex-col gap-0.5">
        {pages.map((page) => (
          <SidebarEntry key={page.key} entry={page} />
        ))}
      </nav>
      <nav aria-label="Settings" className="flex flex-col gap-0.5">
        <a
          href={inFleet(BRIDGE_SETTINGS_PATH, fleetId)}
          data-testid="bridge-side-settings"
          aria-current={screen === 'settings' ? 'page' : undefined}
          className={`px-2.5 pt-3.5 pb-1.5 text-caption font-medium hover:text-foreground ${screen === 'settings' ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          Settings
        </a>
        {settings.map((setting) => (
          <SidebarEntry key={setting.key} entry={setting} />
        ))}
      </nav>
      <div className="mt-auto flex min-w-0 items-center gap-2.5 border-t border-border p-2">{foot}</div>
    </aside>
  );
}
