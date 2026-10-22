'use client';

import type { Theme } from '@aeolus-fleet/common';
import { AppHeader, AppSwitcher, AvatarMenuSheet, type AppSwitcherModel, type AvatarMenuProps } from '@aeolus-fleet/common/header';
import { useSearchParams } from 'next/navigation';
import { useRef, useState } from 'react';

import { setTheme } from '../actions';
import { THEMES } from '../theme';
import { GatewayTabs } from './gateway-tabs';

/** Where the avatar menu's Help leads, as in the console. */
const HELP_URL = 'https://github.com/ThomasHendrickx/aeolus-fleet';

/** The gateway's server ends the shared sign-in here, in every app at once, for a form sent from its own pages. */
const SIGN_OUT_PATH = '/sign-in/end';

/** Applies a theme at once, as the root layout's script does on the next load. */
function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', isDark);
}

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
 * overview and the outside parties. The fleet in view is the one the
 * address names, else the account's first. Sign out ends the shared
 * sign-in in every app and shows "Signing out" until the page leaves.
 */
export function GatewayHeader({ switchers, email, accountUrl, theme }: GatewayHeaderProps) {
  const requested = useSearchParams().get('fleet');
  const switcher = switchers.find(({ fleet }) => fleet.id === requested) ?? switchers[0];
  const [shownTheme, setShownTheme] = useState(theme);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const signOutForm = useRef<HTMLFormElement>(null);

  const account: AvatarMenuProps = {
    name: email,
    signedInAs: 'account',
    accountUrl,
    theme: shownTheme,
    themes: THEMES,
    hasTheme: true,
    onThemeChange: (next) => {
      setShownTheme(next);
      applyTheme(next);
      void setTheme(next);
    },
    shortcuts: [],
    helpUrl: HELP_URL,
    onSignOut: () => {
      setIsSigningOut(true);
      signOutForm.current?.requestSubmit();
    },
    isSigningOut,
  };
  return (
    <>
      <form ref={signOutForm} method="post" action={SIGN_OUT_PATH} hidden />
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
