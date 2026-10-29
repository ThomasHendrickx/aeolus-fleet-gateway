import type { Theme } from '@aeolus-fleet/common';
import { cookies } from 'next/headers';

import { THEME_COOKIE, themeFrom } from '../theme';

/** The theme this browser chose, from its cookie. */
export async function readTheme(): Promise<Theme> {
  return themeFrom((await cookies()).get(THEME_COOKIE)?.value);
}
