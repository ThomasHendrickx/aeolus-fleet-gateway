import type { Theme } from '@aeolus-fleet/common/rules';

/**
 * The browser's one theme, in every Aeolus app (aeolus-fleet,
 * docs/design/header-across-apps.md, T1): the one it chose, and the domain
 * the avatar menu keeps a new choice on, none where the gateway's host keeps
 * its own.
 */
export interface BrowserTheme {
  readonly theme: Theme;
  readonly cookieDomain: string | undefined;
}
