'use client';

import type { Theme } from '@aeolus-fleet/common';
import { AvatarMenu, AvatarMenuSheet } from '@aeolus-fleet/common/header';
import { Globe, Route, SlidersHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';

import { inFleet } from '../../../lib/gateway-api/page-account';
import { useAccountMenu } from '../../frame/hooks/use-account-menu';
import { OUTSIDE_PARTIES_PATH } from '../../outside-parties/paths';
import { useFocusReport } from '../hooks/use-focus-report';
import { useLiveRefresh } from '../hooks/use-live-refresh';
import { BRIDGE_ROUTING_PATH } from '../paths';
import type { BridgeScreen } from '../services/shell';
import { BridgeTopBar } from '../ui/bridge-top-bar';
import { OpenedItemProvider } from './opened-item';

/** The account signed in, as the shell shows it: its email, the account app's address, the theme it chose. */
export interface ShellAccount {
  readonly email: string;
  readonly accountUrl: string | undefined;
  readonly theme: Theme;
}

/**
 * The person at the sidebar's foot (home.html): the avatar opens the
 * avatar menu, beside the account's email and the fleet in view.
 */
export function SidebarPerson({ account: { email, accountUrl, theme }, fleetName, isAllowedAsArgo = false }: { account: ShellAccount; fleetName: string | undefined; isAllowedAsArgo?: boolean }) {
  const { account, signOutForm } = useAccountMenu({ email, accountUrl, theme });
  return (
    <>
      {signOutForm}
      <AvatarMenu {...account} />
      <span className="flex min-w-0 flex-col leading-4">
        <span data-testid="bridge-person" className="truncate font-medium">
          {email}
        </span>
        <span className="truncate text-caption text-muted-foreground">{isAllowedAsArgo ? `${fleetName ?? ''} · allowed as argo` : fleetName}</span>
      </span>
    </>
  );
}

/** The phone's avatar: its sheet carries the settings the tab bar lacks (header design H6). */
function PhoneAvatar({ fleetId, account: { email, accountUrl, theme } }: { fleetId: string; account: ShellAccount }) {
  const { account, signOutForm } = useAccountMenu({
    email,
    accountUrl,
    theme,
    entries: [
      { key: 'routing', label: 'Where things show', icon: <Route aria-hidden />, href: inFleet(BRIDGE_ROUTING_PATH, fleetId), isPhoneOnly: true },
      { key: 'outside-parties', label: 'Outside parties', icon: <Globe aria-hidden />, href: inFleet(OUTSIDE_PARTIES_PATH, fleetId), isPhoneOnly: true },
      ...(accountUrl === undefined ? [] : [{ key: 'fleets-and-account', label: 'Fleets and account', icon: <SlidersHorizontal aria-hidden />, href: accountUrl, isPhoneOnly: true }]),
    ],
  });
  return (
    <>
      {signOutForm}
      <AvatarMenuSheet {...account} />
    </>
  );
}

/**
 * The part of Bridge's shell that lives in the browser: the top bar over
 * the page, Live while the page follows its changes, the phone's title
 * naming an item open in place of its list. It keeps the page live, and
 * tells the gateway while it is in focus (wake a person, W6).
 */
export function ShellFrame({ fleetId, fleetName, screen, account, children }: { fleetId: string; fleetName: string | undefined; screen: BridgeScreen; account: ShellAccount | undefined; children: ReactNode }) {
  const isLive = useLiveRefresh(fleetId);
  useFocusReport(fleetId);
  return (
    <OpenedItemProvider>
      {(opened) => (
        <>
          <BridgeTopBar fleetId={fleetId} fleetName={fleetName} screen={screen} isLive={isLive} opened={opened} avatar={account === undefined ? null : <PhoneAvatar fleetId={fleetId} account={account} />} />
          <main className="w-full max-w-5xl flex-1 px-4 py-5 sm:px-6">{children}</main>
        </>
      )}
    </OpenedItemProvider>
  );
}
