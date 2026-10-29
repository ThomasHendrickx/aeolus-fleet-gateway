'use server';

/** The header's theme choice, kept for this browser for a year. */
import { cookies } from 'next/headers';

import { isTheme, THEME_COOKIE } from './theme';

const YEAR_SECONDS = 365 * 24 * 60 * 60;

export async function setTheme(theme: unknown): Promise<void> {
  if (!isTheme(theme)) {
    return;
  }
  (await cookies()).set(THEME_COOKIE, theme, { path: '/', sameSite: 'lax', maxAge: YEAR_SECONDS });
}
