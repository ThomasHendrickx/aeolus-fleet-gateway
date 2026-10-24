import { describe, expect, it } from 'vitest';

import { applicationServerKeyOf, browserNameOf, subscriptionInputOf } from './web-push';

// What the overview's section of wakes works out in the browser (wake a
// person, W8): the name a browser is listed by, the gateway's push key as
// the browser's push manager takes it, and the subscription it sends.

describe('the name a browser turned on is listed by', () => {
  it.each([
    ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox on Linux'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', 'Chrome on macOS'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0', 'Edge on Windows'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 'Safari on iOS'],
    ['Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36', 'Chrome on Android'],
  ])('names %s as %s', (userAgent, name) => {
    expect(browserNameOf(userAgent)).toBe(name);
  });

  it('names one it does not know as a browser', () => {
    expect(browserNameOf('curl/8.5.0')).toBe('A browser');
  });
});

describe("the gateway's push key, as the browser's push manager takes it", () => {
  it('is the bytes its base64url stands for', () => {
    expect([...applicationServerKeyOf('BAEC_-8')]).toEqual([4, 1, 2, 255, 239]);
  });
});

describe('the subscription the browser sends the gateway', () => {
  it('is its endpoint and keys, with the browser named', () => {
    expect(subscriptionInputOf({ endpoint: 'https://push.example/firefox', keys: { p256dh: 'BKey', auth: 'Auth' } }, 'Firefox on Linux')).toEqual({
      endpoint: 'https://push.example/firefox',
      keys: { p256dh: 'BKey', auth: 'Auth' },
      browser: 'Firefox on Linux',
    });
  });

  it('is none when the push manager gave no endpoint or keys', () => {
    expect([subscriptionInputOf({ keys: { p256dh: 'BKey', auth: 'Auth' } }, 'Firefox'), subscriptionInputOf({ endpoint: 'https://push.example/firefox', keys: {} }, 'Firefox')]).toEqual([undefined, undefined]);
  });
});
