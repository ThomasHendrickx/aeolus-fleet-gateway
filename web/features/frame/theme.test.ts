import { describe, expect, it } from 'vitest';

import { isTheme, themeFrom } from './theme';

describe('the theme this browser chose for the gateway (header design H13)', () => {
  it('reads Light, Dark and System from the cookie', () => {
    expect(['light', 'dark', 'system'].map((value) => themeFrom(value))).toEqual(['light', 'dark', 'system']);
  });

  it('reads System from no cookie', () => {
    expect(themeFrom(undefined)).toBe('system');
  });

  it('reads System from a cookie that names no theme', () => {
    expect(themeFrom('sepia')).toBe('system');
  });

  it('refuses a value that is not a theme', () => {
    expect(['sepia', 'Dark', '', undefined, 1].map((value) => isTheme(value))).toEqual([false, false, false, false, false]);
  });
});
