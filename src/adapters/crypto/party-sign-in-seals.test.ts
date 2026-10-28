import { describe, expect, it } from 'vitest';

import { MATHILDE_SHIP_ID } from '../../../test/support/party-grant-fakes.js';
import { createPartySignInSeals } from './party-sign-in-seals.js';
import { createSlackLinkSeals } from './slack-link-seals.js';

const SECRET = 'a-gateway-secret-of-at-least-32-characters';
const SIGN_IN = { fleetId: 'flt_01m3tb1zgr5h2ffee12xnch8sv' as const, party: 'attio', accountId: 'acc-mathilde', personShipId: MATHILDE_SHIP_ID, verifier: 'a-pkce-verifier', expiresAt: new Date('2026-10-28T14:10:00.000Z') };

describe("a person's sign-in to a party, sealed into the state the authorization server carries back", () => {
  it('opens to the sign-in it seals, safe in a URL, its PKCE verifier unreadable on the way', () => {
    const seals = createPartySignInSeals(SECRET);
    const sealed = seals.seal(SIGN_IN);

    expect({ opened: seals.open(sealed), isUrlSafe: /^[A-Za-z0-9_-]+$/.test(sealed), isVerifierShown: Buffer.from(sealed, 'base64url').toString('latin1').includes(SIGN_IN.verifier) }).toEqual({ opened: SIGN_IN, isUrlSafe: true, isVerifierShown: false });
  });

  it("opens none sealed under another gateway's secret, changed on the way, or sealed as a Slack link's state", () => {
    const seals = createPartySignInSeals(SECRET);
    const sealed = seals.seal(SIGN_IN);
    const link = createSlackLinkSeals(SECRET).seal({ fleetId: SIGN_IN.fleetId, accountId: SIGN_IN.accountId, personShipId: SIGN_IN.personShipId, expiresAt: SIGN_IN.expiresAt });

    expect([createPartySignInSeals('another-gateway-secret-of-32-characters').open(sealed), seals.open(`${sealed.slice(0, -2)}xx`), seals.open(link)]).toEqual([undefined, undefined, undefined]);
  });
});
