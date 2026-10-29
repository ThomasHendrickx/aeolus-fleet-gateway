import type { FleetId, ShipId } from '@aeolus-fleet/common';

/** The outside account a grant names, as the outside service's OpenID Connect ID token stated it; none of it where the server gave no ID token. */
export interface OutsideAccount {
  /** The `sub` the outside issuer named the account by: no two persons' grants of a party name the same one (Q13). */
  readonly subject: string | null;
  /** The account as a person reads it, its email or name, when the ID token named one. */
  readonly name: string | null;
}

/** A grant the authorization server would no longer refresh (Q5): when, and why as the server said it. */
export interface GrantLost {
  readonly at: Date;
  readonly why: string;
}

/**
 * One person's sign-in to one party (decision 0067): the outside account it
 * names and its access and refresh tokens, kept by the gateway alone, under
 * the party's client. A person holds one grant per party; a new sign-in
 * replaces it.
 */
export interface PartyGrant {
  readonly fleetId: FleetId;
  readonly party: string;
  /** The person: their person ship, which owns itself, and the ships it owns call under this grant. */
  readonly personShipId: ShipId;
  readonly accountId: string;
  readonly outsideAccount: OutsideAccount;
  readonly accessToken: string;
  /** None when the authorization server issued none: the grant then ends with its access token. */
  readonly refreshToken: string | null;
  /** None when the authorization server did not say when the access token ends. */
  readonly accessTokenEndsAt: Date | null;
  readonly signedInAt: Date;
  /** When it was last refreshed; none until its first refresh. */
  readonly refreshedAt: Date | null;
  readonly lastUsedAt: Date | null;
  /** None while the grant holds; a lost grant serves no call until the person signs in again in its place. */
  readonly lost: GrantLost | null;
}

/** Whether the grant's access token may still be sent: the grant not lost, and the token's end not reached, or never stated. */
export function isUsable(grant: PartyGrant, now: Date): boolean {
  return grant.lost === null && (grant.accessTokenEndsAt === null || grant.accessTokenEndsAt.getTime() > now.getTime());
}

/** How long before its access token ends a grant is refreshed ahead (Q7): longer than the schedule's round, so the schedule finds it first. */
export const REFRESH_AHEAD_MS = 10 * 60 * 1000;

/** Whether the grant's access token ends within the time a grant is refreshed ahead of, or has ended. */
export function isNearItsEnd(grant: PartyGrant, now: Date): boolean {
  return grant.accessTokenEndsAt !== null && grant.accessTokenEndsAt.getTime() - now.getTime() <= REFRESH_AHEAD_MS;
}

/** How long a grant goes unrefreshed before the schedule refreshes it while idle (Q7, L20): its refresh token used often enough that no idle policy ends it. */
export const IDLE_REFRESH_MS = 24 * 60 * 60 * 1000;

/** Whether the schedule refreshes the grant now (Q7): not lost, holding a refresh token, and near its access token's end or unrefreshed since its sign-in or last refresh for longer than the idle time. */
export function isDueForRefresh(grant: PartyGrant, now: Date): boolean {
  if (grant.lost !== null || grant.refreshToken === null) {
    return false;
  }
  const refreshedLast = grant.refreshedAt ?? grant.signedInAt;
  return isNearItsEnd(grant, now) || now.getTime() - refreshedLast.getTime() > IDLE_REFRESH_MS;
}

const MS_PER_SECOND = 1000;

/** When an access token issued now ends, from the seconds the authorization server said it lasts; none where it said nothing. */
export function accessTokenEndsAtOf(now: Date, expiresInSeconds: number | null): Date | null {
  return expiresInSeconds === null ? null : new Date(now.getTime() + expiresInSeconds * MS_PER_SECOND);
}
