/**
 * The gateway's pending requests (decision 0056): an outside MCP client's
 * authorize request, or a person's request for an outside MCP server, in one
 * list, kept 7 days, decided once by an actor holding gateway:approve.
 */
import type { FleetId, ShipId } from '@aeolus-fleet/common';

/** What a request is for: an outside MCP client, by its OAuth client id and name, or an outside MCP server, by its address. */
export type RequestSubject = { readonly kind: 'client'; readonly clientId: string; readonly clientName: string } | { readonly kind: 'server'; readonly url: string };

/** An account that asked, and its person ship, which hears the outcome. */
export interface Requester {
  readonly accountId: string;
  readonly personShipId: ShipId | null;
}

/**
 * Where a request stands:
 * - pending: it waits for a decision;
 * - approving: an approver approved it, and its proxy ship is being commissioned; it still counts as open;
 * - approved, denied: decided, the first decision counting;
 * - expired: 7 days passed with no decision.
 */
export type RequestState = 'pending' | 'approving' | 'approved' | 'denied' | 'expired';

/** Who decided: an actor (decision 0057), without its scopes. */
export type DecidedBy = { readonly kind: 'operator' | 'viewer' } | { readonly kind: 'ship'; readonly shipId: ShipId };

export interface PendingRequest {
  readonly fleetId: FleetId;
  readonly requestId: string;
  readonly subject: RequestSubject;
  readonly requesters: readonly Requester[];
  readonly askedAt: Date;
  readonly expiresAt: Date;
  readonly state: RequestState;
  readonly decidedBy: DecidedBy | null;
  readonly decidedAt: Date | null;
}

/** Outbound port: the pending requests, by fleet. */
export interface PendingRequests {
  /**
   * Keeps a new request, or joins the one open for the same client or server
   * in the fleet, adding its requester once. A pending one expired by now is
   * marked expired first, so a new one opens.
   */
  open(request: PendingRequest & { now: Date }): Promise<PendingRequest>;
  find(fleetId: FleetId, requestId: string): Promise<PendingRequest | undefined>;
  /** The open requests not expired by now, the oldest first. */
  listOpen(fleetId: FleetId, now: Date): Promise<PendingRequest[]>;
  /** Takes a pending request, not expired by now, for approving; false when it is not. */
  claim(fleetId: FleetId, claim: { requestId: string; now: Date }): Promise<boolean>;
  /** Gives an approving request back as pending, when its proxy ship was refused. */
  release(fleetId: FleetId, requestId: string): Promise<void>;
  /** Records the decision on a request in one of the states given; false when it was in none, so the first decision counts. */
  decide(fleetId: FleetId, decided: { requestId: string; from: readonly RequestState[]; decision: { outcome: 'approved' | 'denied'; decidedBy: DecidedBy; decidedAt: Date } }): Promise<boolean>;
}

/** Outbound port: new request ids, prefixed `req_` and time-ordered. */
export interface RequestIds {
  newRequestId(): string;
}
