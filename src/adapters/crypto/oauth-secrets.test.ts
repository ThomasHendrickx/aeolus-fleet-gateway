import { describe, expect, it } from 'vitest';

import { oauthSecrets } from './oauth-secrets.js';

describe("the OAuth server's secrets", () => {
  it('computes the S256 challenge of RFC 7636 appendix B', () => {
    expect(oauthSecrets.challengeOf('dBjftJeZ4CVP-mJ92K7PPq7_WJ6_N3Q7-JP9vE0rjU0')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('draws 256 bits, safe in a URL, and never the same twice', () => {
    const drawn = [oauthSecrets.newSecret(), oauthSecrets.newSecret()];

    expect(drawn.map((secret) => /^[A-Za-z0-9_-]{43}$/.test(secret))).toEqual([true, true]);
    expect(drawn[0]).not.toBe(drawn[1]);
  });

  it('keeps a secret as its SHA-256 in hex', () => {
    expect(oauthSecrets.hashOf('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
