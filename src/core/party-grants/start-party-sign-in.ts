import type { Actor } from '../actors/authenticate-actor.js';
import type { OAuthSecrets } from '../oauth/ports.js';
import type { Clock } from '../shared/clock.js';
import { ok, type Result } from '../shared/result.js';
import type { PartySignIns, PartySignInSeals, SignInServers } from './ports.js';
import { signInPartyOf, type SignInPartyRefusal } from './sign-in-party.js';

/** How long a sign-in the gateway started may take to come back from the outside authorization server. */
export const PARTY_SIGN_IN_MS = 10 * 60 * 1000;

export type StartPartySignInRefusal = SignInPartyRefusal;

export type StartPartySignIn = (input: { actor: Actor; name: string }) => Promise<Result<{ url: string }, StartPartySignInRefusal>>;

/**
 * Use case: a person presses Sign in on an outside MCP server's page, for
 * themselves (decision 0067, Q16): every account of the fleet with a person
 * ship may. The gateway seals whose sign-in it is and its PKCE verifier into
 * the state, for ten minutes, and sends the person to the party's
 * authorization server under the party's client.
 */
export function createStartPartySignIn(deps: {
  servers: SignInServers;
  seals: PartySignInSeals;
  signIns: Pick<PartySignIns, 'authorizeUrl'>;
  secrets: Pick<OAuthSecrets, 'newSecret' | 'challengeOf'>;
  clock: Clock;
  /** Where the authorization server sends the person back: the redirect URI the party's client was registered with. */
  redirectUri: string;
}): StartPartySignIn {
  return async ({ actor, name }) => {
    const signingIn = await signInPartyOf(deps.servers, { actor, name });
    if (!signingIn.isOk) {
      return signingIn;
    }
    const { client, accountId, personShipId } = signingIn.value;
    const verifier = deps.secrets.newSecret();
    const state = deps.seals.seal({
      fleetId: actor.fleetId,
      party: name,
      accountId,
      personShipId,
      verifier,
      expiresAt: new Date(deps.clock.now().getTime() + PARTY_SIGN_IN_MS),
    });
    return ok({ url: deps.signIns.authorizeUrl(client, { state, codeChallenge: deps.secrets.challengeOf(verifier), redirectUri: deps.redirectUri }) });
  };
}
