'use client';

import type { Theme } from '@aeolus-fleet/common';
import type { AppSwitcherModel } from '@aeolus-fleet/common/rules';
import { AppHeader, AppSwitcher, AvatarMenuSheet } from '@aeolus-fleet/ui';
import { usePathname, useSearchParams } from 'next/navigation';

import { useAccountMenu } from '../hooks/use-account-menu';
import { switcherOnPage } from '../services/header-switchers';
import { GatewayTabs } from './gateway-tabs';

interface GatewayHeaderProps {
  /** One per fleet the account may open, with it in view; the address picks one. */
  switchers: readonly AppSwitcherModel[];
  email: string;
  /** Account's address, for the avatar menu's Your account, Your rights and Email updates. */
  accountUrl: string | undefined;
  theme: Theme;
}

/**
 * The header every Aeolus app shows (aeolus-fleet, header design), on the
 * gateway's pages: from 640 px the shared AppHeader, with the switcher in
 * the title and the avatar menu; on phone a bar with the switcher compact
 * and the avatar's bottom Sheet (H6). After the title, the tabs to the
 * Bridge, the outside parties and the parties. The fleet in view is the one the
 * address names, else the account's first; choosing another fleet keeps
 * the page (H9). Sign out ends the shared
 * sign-in in every app and shows "Signing out" until the page leaves.
 */
export function GatewayHeader({ switchers, email, accountUrl, theme }: GatewayHeaderProps) {
  const requested = useSearchParams().get('fleet');
  const pathname = usePathname();
  const inView = switchers.find(({ fleet }) => fleet.id === requested) ?? switchers[0];
  const switcher = inView === undefined ? undefined : switcherOnPage(inView, pathname);
  const { account, signOutForm } = useAccountMenu({ email, accountUrl, theme });
  return (
    <>
      {signOutForm}
      <AppHeader switcher={switcher} account={account} className="max-sm:hidden">
        {switcher === undefined ? null : <GatewayTabs fleetId={switcher.fleet.id} />}
      </AppHeader>
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4 sm:hidden">
        {switcher === undefined ? null : <AppSwitcher switcher={switcher} layout="compact" className="min-w-0" />}
        {switcher === undefined ? null : <GatewayTabs fleetId={switcher.fleet.id} />}
        <span className="grow" />
        <AvatarMenuSheet {...account} />
      </header>
    </>
  );
}
