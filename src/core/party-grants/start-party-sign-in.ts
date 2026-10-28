import type { Actor } from '../actors/authenticate-actor.js';
import type { OAuthSecrets } from '../oauth/ports.js';
import type { PartyStore } from '../parties/ports.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { PartySignIns, PartySignInSeals } from './ports.js';

/** How long a sign-in the gateway started may take to come back from the outside authorization server. */
export const PARTY_SIGN_IN_MS = 10 * 60 * 1000;

export type StartPartySignInRefusal = DomainError<'NOT_A_PERSON' | 'NO_SUCH_PARTY' | 'NO_SIGN_IN'>;

export type StartPartySignIn = (input: { actor: Actor; name: string }) => Promise<Result<{ url: string }, StartPartySignInRefusal>>;

/**
 * Use case: a person presses Sign in on an outside MCP server's page, for
 * themselves (decision 0067, Q16): every account of the fleet with a person
 * ship may. The gateway seals whose sign-in it is and its PKCE verifier into
 * the state, for ten minutes, and sends the person to the party's
 * authorization server under the party's client.
 */
export function createStartPartySignIn(deps: {
  parties: Pick<PartyStore, 'find'>;
  seals: PartySignInSeals;
  signIns: Pick<PartySignIns, 'authorizeUrl'>;
  secrets: Pick<OAuthSecrets, 'newSecret' | 'challengeOf'>;
  clock: Clock;
  /** Where the authorization server sends the person back: the redirect URI the party's client was registered with. */
  redirectUri: string;
}): StartPartySignIn {
  return async ({ actor, name }) => {
    if (actor.kind !== 'account' || actor.personShipId === null) {
      return refuse('NOT_A_PERSON', 'Only a person signs in to an outside server, and your account has no person ship in this fleet');
    }
    const party = await deps.parties.find(actor.fleetId, name);
    if (party?.kind !== 'mcpServer') {
      return refuse('NO_SUCH_PARTY', `There is no outside MCP server ${name}`);
    }
    if (party.credential.kind !== 'personSignIn') {
      return refuse('NO_SIGN_IN', `Nobody signs in to ${name} for themselves: the gateway calls it with its own credential`);
    }
    const verifier = deps.secrets.newSecret();
    const state = deps.seals.seal({
      fleetId: actor.fleetId,
      party: name,
      accountId: actor.accountId,
      personShipId: actor.personShipId,
      verifier,
      expiresAt: new Date(deps.clock.now().getTime() + PARTY_SIGN_IN_MS),
    });
    return ok({ url: deps.signIns.authorizeUrl(party.credential.client, { state, codeChallenge: deps.secrets.challengeOf(verifier), redirectUri: deps.redirectUri }) });
  };
}
