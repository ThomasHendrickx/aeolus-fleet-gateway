/** A domain name such as aeolus-fleet.dev: labels of letters, digits and inner hyphens, joined by dots. */
const DOMAIN_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

/**
 * The domain the Aeolus apps share, from AEOLUS_THEME_COOKIE_DOMAIN, where
 * the browser's one theme is kept for every app (aeolus-fleet,
 * docs/design/header-across-apps.md, T1); none without one, or with no
 * domain name: the gateway's host keeps its own.
 */
export function themeCookieDomainFrom(environment: Readonly<Record<string, string | undefined>>): string | undefined {
  const configured = environment.AEOLUS_THEME_COOKIE_DOMAIN;
  return configured !== undefined && DOMAIN_NAME.test(configured) ? configured : undefined;
}
