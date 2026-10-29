import type { FleetId } from '@aeolus-fleet/common';

import type { AccountOfSignIn } from '../account-sign-in/account-of-sign-in.js';
import type { Clock } from '../shared/clock.js';
import type { DomainError, DomainErrorKind } from '../shared/errors.js';
import { err, ok, type Result } from '../shared/result.js';
import type { SignInClient } from '../vault/credential.js';
import { accessTokenEndsAtOf, type OutsideAccount } from './party-grant.js';
import type { IdTokenClaims, PartyGrants, PartySignIns, PartySignInSeals, SignInNotices, SignInServers, StatesProxyShip } from './ports.js';

/** The party's page a refusal goes back to: none when the state names no sign-in the gateway started. */
export interface SignInPage {
  readonly fleetId: FleetId;
  readonly party: string;
}

export type CompletePartySignInRefusal = DomainError<'SIGN_IN_FAILED' | 'NOT_SIGNED_IN' | 'TURNED_AWAY' | 'AUTHORIZATION_SERVER_UNREACHABLE' | 'NO_SUCH_PARTY'> & {
  readonly at: SignInPage | null;
  /** The OAuth error code the authorization server answered, if it answered one. */
  readonly serverError: string | null;
};

export type CompletePartySignIn = (back: {
  state: string | undefined;
  code: string | undefined;
  error: string | undefined;
  /** The issuer the authorization response names (RFC 9207), if it names one. */
  iss: string | undefined;
  /** The browser's shared sign-in, as pagasae's cookie carries it. */
  signIn: string | undefined;
}) => Promise<Result<SignInPage & { /** Why the proxy ship's statement waits for its next one; none when it was stated. */ statementRefusal: string | null }, CompletePartySignInRefusal>>;

function refused(at: SignInPage | null, refusal: { kind: CompletePartySignInRefusal['kind'] & DomainErrorKind; message: string; serverError?: string | null }) {
  return err({ serverError: null, ...refusal, at });
}

/** The outside account an ID token names, once it is checked to be the party's issuer's, for the party's client; none when it is not. */
function outsideAccountOf(idToken: IdTokenClaims | null, client: SignInClient): OutsideAccount | undefined {
  if (idToken === null) {
    return { subject: null, name: null };
  }
  // Redeemed over TLS straight from the token endpoint, so its issuer and audience are what is left to check (OpenID Connect Core 3.1.3.7).
  if (idToken.issuer !== client.issuer || !idToken.audiences.includes(client.clientId)) {
    return undefined;
  }
  return { subject: idToken.subject, name: idToken.name };
}

/**
 * Use case: the outside authorization server sends a person back from
 * signing in to a party for themselves (decision 0067). Within the sign-in's
 * ten minutes, in a browser whose shared sign-in names the account that
 * started it, and with the party's issuer where the response names one or
 * the server states it always does (RFC 9207), the code is redeemed with
 * the party's client and the sign-in's PKCE verifier; else it is never
 * redeemed. A person who denied consent is not signed in. Where the ID
 * token names an outside account another person's grant already names, the
 * person is turned away and the tokens are dropped (Q13). Else the grant is
 * kept in place of the person's earlier one, the notice that told them a
 * call needed it is closed, so a later loss tells them again (Q6), and the
 * proxy ship is stated from it (Q15). Nothing is kept on any refusal.
 */
export function createCompletePartySignIn(deps: {
  servers: SignInServers;
  grants: Pick<PartyGrants, 'ofSubject' | 'keep'>;
  seals: PartySignInSeals;
  signIns: Pick<PartySignIns, 'redeemCode'>;
  notices: Pick<SignInNotices, 'close'>;
  accountOf: (asked: Parameters<AccountOfSignIn>[0]) => ReturnType<AccountOfSignIn>;
  stateParty: StatesProxyShip;
  clock: Clock;
  redirectUri: string;
}): CompletePartySignIn {
  return async ({ state, code, error, iss, signIn }) => {
    const now = deps.clock.now();
    const underWay = state === undefined ? undefined : deps.seals.open(state);
    if (underWay === undefined || underWay.expiresAt <= now) {
      return refused(null, { kind: 'SIGN_IN_FAILED', message: 'This sign-in did not start at the gateway, or took longer than ten minutes: press Sign in again' });
    }
    const { fleetId, party: name, accountId, personShipId, verifier } = underWay;
    const at = { fleetId, party: name };
    const signedIn = signIn === undefined ? undefined : await deps.accountOf({ signIn, fleetId });
    if (signedIn === undefined || !signedIn.isOk || signedIn.value.accountId !== accountId) {
      return refused(at, { kind: 'SIGN_IN_FAILED', message: 'This sign-in was started by another account or browser: sign in and press Sign in again' });
    }
    const server = await deps.servers.find(fleetId, name);
    if (server === undefined || server.client === null) {
      return refused(at, { kind: 'NO_SUCH_PARTY', message: `There is no outside MCP server ${name} to sign in to any more` });
    }
    const { client } = server;
    if (error !== undefined || code === undefined) {
      return refused(at, { kind: 'NOT_SIGNED_IN', message: `You are not signed in to ${name}: the sign-in was cancelled or refused there`, serverError: error ?? null });
    }
    if (iss === undefined ? client.isIssuerInResponse : iss !== client.issuer) {
      return refused(at, { kind: 'SIGN_IN_FAILED', message: `The sign-in came back without the issuer of ${name}, ${client.issuer}: press Sign in again` });
    }
    const redeemed = await deps.signIns.redeemCode(client, { code, verifier, redirectUri: deps.redirectUri });
    if (!redeemed.isOk) {
      return redeemed.error.kind === 'refused'
        ? refused(at, { kind: 'SIGN_IN_FAILED', message: `${client.issuer} refused the sign-in: ${redeemed.error.reason}`, serverError: redeemed.error.error })
        : refused(at, { kind: 'AUTHORIZATION_SERVER_UNREACHABLE', message: `${client.issuer} did not answer: ${redeemed.error.reason}` });
    }
    const tokens = redeemed.value;
    const outsideAccount = outsideAccountOf(tokens.idToken, client);
    if (outsideAccount === undefined) {
      return refused(at, { kind: 'SIGN_IN_FAILED', message: `${client.issuer} answered an ID token that is not its own for this server's client: press Sign in again` });
    }
    const turnedAway = () => refused(at, { kind: 'TURNED_AWAY', message: `That ${name} account is another person's sign-in in this fleet: sign in as your own` });
    const { subject } = outsideAccount;
    const holder = subject === null ? undefined : await deps.grants.ofSubject(fleetId, { party: name, subject });
    if (holder !== undefined && holder.personShipId !== personShipId) {
      return turnedAway();
    }
    const kept = await deps.grants.keep({
      fleetId,
      party: name,
      personShipId,
      accountId,
      outsideAccount,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenEndsAt: accessTokenEndsAtOf(now, tokens.expiresInSeconds),
      signedInAt: now,
      lastUsedAt: null,
    });
    if (kept === 'subjectTaken') {
      // Another person signed in as the same outside account meanwhile.
      return turnedAway();
    }
    await deps.notices.close(fleetId, { party: name, personShipId });
    const stated = await deps.stateParty({ fleetId, name });
    return ok({ ...at, statementRefusal: stated.isOk ? null : stated.error.message });
  };
}
