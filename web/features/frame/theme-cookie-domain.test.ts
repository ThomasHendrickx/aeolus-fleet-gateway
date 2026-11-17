import { describe, expect, it } from 'vitest';

import { themeCookieDomainFrom } from './theme-cookie-domain';

describe('where the gateway keeps the browser\'s one theme (header-across-apps T1)', () => {
  it('keeps it on the domain the Aeolus apps share, as AEOLUS_THEME_COOKIE_DOMAIN names it', () => {
    expect(themeCookieDomainFrom({ AEOLUS_THEME_COOKIE_DOMAIN: 'aeolus-fleet.dev' })).toBe('aeolus-fleet.dev');
  });

  it("keeps it on the gateway's host alone where the apps share no domain", () => {
    expect(themeCookieDomainFrom({})).toBeUndefined();
  });

  it('keeps it on the gateway\'s host alone for a value that names no domain', () => {
    expect(['', 'https://aeolus-fleet.dev', 'aeolus fleet.dev', '.aeolus-fleet.dev', 'aeolus-fleet.dev; Secure'].map((value) => themeCookieDomainFrom({ AEOLUS_THEME_COOKIE_DOMAIN: value }))).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});
