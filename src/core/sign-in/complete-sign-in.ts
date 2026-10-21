import type { FleetId } from '@aeolus-fleet/common';

import { issueCode, redirectWith } from '../oauth/issue-code.js';
import type { AuthorizationCodes, OAuthSecrets } from '../oauth/ports.js';
import type { AuthorizationRefusal, ReadAuthorization } from '../oauth/read-authorization.js';
import type { AskForClient, ClientAnswer } from '../requests/ask-for-client.js';
import type { Clock } from '../shared/clock.js';
import { err, ok, type Result } from '../shared/result.js';
import type { AccountGrants, Pagasae, SignInSeals } from './ports.js';

/**
 * Why a sign-in gave the client no code, beside the request's own refusals:
 * - unknownSignIn: the gateway sealed no sign-in into this state, or its 10 minutes passed;
 * - otherBrowser: the browser that came back does not hold the sign-in's secret, as when another site makes it finish its own;
 * - pagasaeRefused: pagasae did not redeem its code, for the reason given;
 * - fleetNotServed: the account's fleet is one this gateway does not serve;
 * - outsidePartiesOff: the person asked for access for the client while the fleet's outside parties are off (interop I-3).
 */
export type SignInRefusal = AuthorizationRefusal | { readonly kind: 'unknownSignIn' } | { readonly kind: 'otherBrowser' } | { readonly kind: 'pagasaeRefused'; readonly message: string } | { readonly kind: 'fleetNotServed' } | { readonly kind: 'outsidePartiesOff' };

/** What a sign-in answers: the client's answer. */
export type SignInAnswer = ClientAnswer;

interface Back {
  state?: string | undefined;
  code?: string | undefined;
  error?: string | undefined;
  browserSecret?: string | undefined;
}

export type CompleteSignIn = (back: Back) => Promise<Result<SignInAnswer, SignInRefusal>>;

/**
 * Use case: pagasae sends the person back. Their sign-in is opened from its
 * state, the client's request read again, and pagasae's code redeemed with
 * the gateway's verifier; pagasae takes a code once. Then, as the person
 * picked: the account's grant is kept, and the client is sent back with the
 * gateway's own code for it, acting in the fleet as the account with no
 * approval (orchestrator-1, slice 7 Q1); or the account asks for access for
 * the client, as an outside party (decision 0056).
 */
export function createCompleteSignIn(deps: {
  readAuthorization: ReadAuthorization;
  seals: SignInSeals;
  pagasae: Pagasae;
  grants: AccountGrants;
  codes: AuthorizationCodes;
  secrets: OAuthSecrets;
  clock: Clock;
  issuer: string;
  /** Whether the gateway serves the fleet: connected to it, and switched on where an installation switches fleets (decision 0021). */
  servesFleet: (fleetId: FleetId) => Promise<boolean>;
  askForClient: AskForClient;
}): CompleteSignIn {
  return async (back) => {
    const { state, code, error, browserSecret } = back;
    const signIn = state === undefined ? undefined : deps.seals.open(state);
    if (signIn === undefined || signIn.expiresAt.getTime() <= deps.clock.now().getTime()) {
      return err({ kind: 'unknownSignIn' });
    }
    if (browserSecret !== signIn.browserSecret) {
      return err({ kind: 'otherBrowser' });
    }
    const read = await deps.readAuthorization(signIn.request);
    if (!read.isOk) {
      return read;
    }
    const authorization = read.value;
    if (error !== undefined || code === undefined) {
      return ok({ kind: 'answered', redirectTo: redirectWith(authorization.redirectUri, { error: 'access_denied', state: authorization.state, iss: deps.issuer }) });
    }
    const redeemed = await deps.pagasae.redeemCode({ code, verifier: signIn.verifier });
    if (!redeemed.isOk) {
      return err({ kind: 'pagasaeRefused', message: redeemed.error.reason });
    }
    const tokens = redeemed.value;
    if (!(await deps.servesFleet(tokens.fleetId))) {
      return err({ kind: 'fleetNotServed' });
    }
    if (authorization.clientFleetId !== null && authorization.clientFleetId !== tokens.fleetId) {
      return err({ kind: 'invalidClient', message: `${authorization.clientName} is registered for another fleet` });
    }
    const { fleetId, accountId, personShipId, scopes, refreshToken, accountToken, accountTokenExpiresAt } = tokens;
    if (signIn.holder === 'party') {
      const asked = await deps.askForClient({ fleetId, requester: { accountId, personShipId }, authorization, request: signIn.request, browserSecret: signIn.browserSecret });
      return asked.isOk ? asked : err({ kind: 'outsidePartiesOff' });
    }
    const grantId = deps.secrets.newSecret();
    await deps.grants.save({ grantId, fleetId, accountId, personShipId, scopes, refreshToken, accountToken, accountTokenExpiresAt });
    return ok({ kind: 'answered', redirectTo: await issueCode(deps, { fleetId, authorization, holder: { kind: 'account', grantId } }) });
  };
}
