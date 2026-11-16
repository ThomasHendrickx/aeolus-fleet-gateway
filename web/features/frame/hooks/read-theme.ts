import { themeOfCookies } from '@aeolus-fleet/common/rules';
import { headers } from 'next/headers';

import type { BrowserTheme } from '../browser-theme';
import { themeCookieDomainFrom } from '../theme-cookie-domain';

/** The theme this browser chose in any Aeolus app, from the cookie they share, and where a new choice is kept. */
export async function readTheme(): Promise<BrowserTheme> {
  return { theme: themeOfCookies((await headers()).get('cookie') ?? undefined), cookieDomain: themeCookieDomainFrom(process.env) };
}
