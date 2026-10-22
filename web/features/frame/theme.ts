/**
 * The theme this browser chose for the gateway's pages (header design H13:
 * each app keeps its own), System until chosen.
 */
import type { Theme } from '@aeolus-fleet/common';

/** The themes, as common names them: written here so the header's browser code loads no schema (decision 0033). */
export const THEMES: readonly Theme[] = ['light', 'dark', 'system'];

/** The cookie that keeps it. */
export const THEME_COOKIE = 'aeolus_gateway_theme';

export function isTheme(value: unknown): value is Theme {
  return THEMES.some((theme) => theme === value);
}

/** The theme a cookie names, or System. */
export function themeFrom(value: string | undefined): Theme {
  return isTheme(value) ? value : 'system';
}
