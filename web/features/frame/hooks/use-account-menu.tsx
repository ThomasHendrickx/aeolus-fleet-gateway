'use client';

import type { Theme } from '@aeolus-fleet/common';
import type { AvatarMenuEntry, AvatarMenuProps } from '@aeolus-fleet/common/header';
import { useRef, useState, type ReactNode } from 'react';

import { setTheme } from '../actions';
import { THEMES } from '../theme';

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

export interface AccountMenuOf {
  readonly email: string;
  /** Account's address, for the avatar menu's Your account, Your rights and Email updates. */
  readonly accountUrl: string | undefined;
  readonly theme: Theme;
  /** The page's own entries, such as the phone's for what its tab bar lacks. */
  readonly entries?: readonly AvatarMenuEntry[];
}

/**
 * The avatar menu of the account signed in (header design H8): its theme,
 * applied at once and kept, and sign out, which ends the shared sign-in in
 * every app and says "Signing out" until the page leaves. The form that
 * signs out goes on the page beside the menu.
 */
export function useAccountMenu({ email, accountUrl, theme, entries = [] }: AccountMenuOf): { account: AvatarMenuProps; signOutForm: ReactNode } {
  const [shownTheme, setShownTheme] = useState(theme);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const form = useRef<HTMLFormElement>(null);
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
      form.current?.requestSubmit();
    },
    isSigningOut,
    entries,
  };
  return { account, signOutForm: <form ref={form} method="post" action={SIGN_OUT_PATH} hidden /> };
}
