/**
 * The ports of a person's sign-in to an outside MCP server that takes only
 * an OAuth sign-in (decision 0067): the grants the gateway keeps, the sign-in
 * under way sealed into its state, and the party's authorization server.
 */
import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { Result } from '../shared/result.js';
import type { SignInClient } from '../vault/credential.js';
import type { PartyGrant } from './party-grant.js';

/** An outside MCP server as a person's sign-in sees it: its sign-in client where each person signs in, none where the gateway calls it with its own credential. */
export interface SignInServer {
  readonly fleetId: FleetId;
  readonly name: string;
  readonly client: SignInClient | null;
}

/** Outbound port: the outside MCP servers of a fleet, by the name of their proxy ship. */
export interface SignInServers {
  /** The outside MCP server of this name; none when the name is no outside MCP server. */
  find(fleetId: FleetId, name: string): Promise<SignInServer | undefined>;
}

/** Outbound port: states what a server's proxy ship offers, from the grants now kept (Q15); the refusal says why the statement waits. */
export type StatesProxyShip = (input: { fleetId: FleetId; name: string }) => Promise<Result<unknown, { readonly message: string }>>;

/** Outbound port: every person's grant of each party, in the gateway's database. */
export interface PartyGrants {
  ofPerson(fleetId: FleetId, grant: { party: string; personShipId: ShipId }): Promise<PartyGrant | undefined>;
  /** The grants of the party, by person ship, after the person ship named, at most as many as asked. */
  ofParty(fleetId: FleetId, asked: { party: string; after: ShipId | null; limit: number }): Promise<PartyGrant[]>;
  /** Every grant of the account in the fleet, one per party at most. */
  ofAccount(fleetId: FleetId, accountId: string): Promise<PartyGrant[]>;
  /** The grant of the party that names this outside account, whoever holds it. */
  ofSubject(fleetId: FleetId, grant: { party: string; subject: string }): Promise<PartyGrant | undefined>;
  /** A grant of the party whose access token may still be sent, the most recently used first, then the most recently signed in (Q15). */
  usable(fleetId: FleetId, asked: { party: string; now: Date }): Promise<PartyGrant | undefined>;
  /** Keeps the grant in place of the person's earlier one; none kept when another person's grant of the party names its outside account, as two sign-ins at once find. */
  keep(grant: PartyGrant): Promise<'kept' | 'subjectTaken'>;
  /**
   * Holds the person's grant while the change runs, so one change at a time
   * runs on it, also across gateway instances, and keeps the grant it
   * answers before another change reads it; none when the person holds no
   * grant of the party.
   */
  change(grant: Pick<PartyGrant, 'fleetId' | 'party' | 'personShipId'>, change: (held: PartyGrant) => Promise<PartyGrant>): Promise<PartyGrant | undefined>;
  /** The grants of every fleet the schedule refreshes now (Q7), at most a round's worth, those whose access token ends first first. */
  due(asked: { now: Date }): Promise<PartyGrant[]>;
  /** Sets when the person's grant last served a call. */
  markUsed(grant: Pick<PartyGrant, 'fleetId' | 'party' | 'personShipId'>, at: Date): Promise<void>;
  remove(fleetId: FleetId, grant: { party: string; personShipId: ShipId }): Promise<void>;
}

/** A person's sign-in to a party under way at its authorization server: whose it is, and its PKCE verifier. */
export interface PartySignInUnderWay {
  readonly fleetId: FleetId;
  readonly party: string;
  readonly accountId: string;
  readonly personShipId: ShipId;
  readonly verifier: string;
  readonly expiresAt: Date;
}

/** Outbound port: seals a sign-in under way into the state the authorization server carries back, so the gateway stores nothing for it. */
export interface PartySignInSeals {
  seal(signIn: PartySignInUnderWay): string;
  /** The sign-in a state seals; none for a state the gateway did not seal. */
  open(state: string): PartySignInUnderWay | undefined;
}

/** What an OpenID Connect ID token claims, read and not yet checked: the core checks it names the party's issuer and client. */
export interface IdTokenClaims {
  readonly issuer: string;
  readonly audiences: readonly string[];
  readonly subject: string;
  readonly name: string | null;
}

/** The token endpoint's answer to a redeemed code. */
export interface RedeemedTokens {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresInSeconds: number | null;
  /** None when the authorization server sent no ID token. */
  readonly idToken: IdTokenClaims | null;
}

/** The token endpoint's answer to a refresh (RFC 6749 6): a new refresh token only where the server rotates them. */
export type RefreshedTokens = Omit<RedeemedTokens, 'idToken'>;

/**
 * Why a token request gave no tokens: the authorization server answered an
 * OAuth error (refused, with its error code), or did not answer
 * (unreachable).
 */
export type TokenRequestFailure = { readonly kind: 'refused'; readonly error: string; readonly reason: string } | { readonly kind: 'unreachable'; readonly reason: string };

/** Outbound port: a party's authorization server, reached with the party's client. */
export interface PartySignIns {
  /** The authorize address a person's browser goes to: the code flow with PKCE S256, the client's scope and resource (RFC 8707). */
  authorizeUrl(client: SignInClient, asked: { state: string; codeChallenge: string; redirectUri: string }): string;
  redeemCode(client: SignInClient, asked: { code: string; verifier: string; redirectUri: string }): Promise<Result<RedeemedTokens, TokenRequestFailure>>;
  refresh(client: SignInClient, refreshToken: string): Promise<Result<RefreshedTokens, TokenRequestFailure>>;
  /** Revokes a token at the client's revocation endpoint (RFC 7009). */
  revoke(client: SignInClient & { revocationEndpoint: string }, token: string): Promise<Result<void, { reason: string }>>;
}

/** The notice a person is told by when a call needs their sign-in to a party (Q6): its id keys the message, so one sent again is stored once. */
export interface SignInNotice {
  readonly noticeId: string;
  readonly isTold: boolean;
}

/** Outbound port: the notices of a missing sign-in, one per person and party while open. */
export interface SignInNotices {
  /** The person's open notice for the party, opened under this id unless one is open already, as two calls at once find. */
  open(fleetId: FleetId, notice: { party: string; personShipId: ShipId; noticeId: string }): Promise<SignInNotice>;
  markTold(fleetId: FleetId, notice: { party: string; personShipId: ShipId }): Promise<void>;
  /** Closes it at a sign-in, so a later loss tells the person again (Q6). */
  close(fleetId: FleetId, notice: { party: string; personShipId: ShipId }): Promise<void>;
}
