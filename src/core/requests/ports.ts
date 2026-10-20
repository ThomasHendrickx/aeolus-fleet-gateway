/**
 * The gateway's pending requests (decision 0056): an outside MCP client's
 * authorize request, or a person's request for an outside MCP server, in one
 * list, kept 7 days, decided once by an actor holding gateway:approve.
 */
import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../connection/ports.js';
import type { Result } from '../shared/result.js';

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
export type DecidedBy = { readonly kind: 'operator' | 'viewer' } | { readonly kind: 'ship'; readonly shipId: ShipId } | { readonly kind: 'account'; readonly accountId: string };

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
  /** The latest request for the client or server the account asked for, in any state, and whether the account was told its end. */
  latestAskedBy(fleetId: FleetId, asked: { subject: RequestSubject; accountId: string }): Promise<{ request: PendingRequest; isTold: boolean } | undefined>;
  /** Marks that the account was told the request ended, so its next try asks anew. */
  markTold(fleetId: FleetId, told: { requestId: string; accountId: string }): Promise<void>;
  /** The open requests not expired by now, the oldest first. */
  listOpen(fleetId: FleetId, now: Date): Promise<PendingRequest[]>;
  /** The requests an account asked in the fleet, in any state, the newest first. */
  listMine(fleetId: FleetId, accountId: string): Promise<PendingRequest[]>;
  /** Takes a pending request, not expired by now, for approving; false when it is not. */
  claim(fleetId: FleetId, claim: { requestId: string; now: Date }): Promise<boolean>;
  /** Gives an approving request back as pending, when its proxy ship was refused. */
  release(fleetId: FleetId, requestId: string): Promise<void>;
  /**
   * Records the decision on a request in one of the states given, and the
   * outcomes to tell, in one step; false when it was in none, so the first
   * decision counts and only it is told.
   */
  decide(
    fleetId: FleetId,
    decided: { requestId: string; from: readonly RequestState[]; decision: { outcome: 'approved' | 'denied'; decidedBy: DecidedBy; decidedAt: Date }; notices: readonly OutcomeNotice[] },
  ): Promise<boolean>;
  /** The requests still pending once their 7 days passed by now, in every fleet: the ones to expire. */
  listDue(now: Date): Promise<PendingRequest[]>;
  /** Expires a request still pending and due by now, with the outcomes to tell, in one step; false when it is not. */
  expire(fleetId: FleetId, expired: { requestId: string; now: Date; notices: readonly OutcomeNotice[] }): Promise<boolean>;
}

/** Outbound port: new request ids, prefixed `req_` and time-ordered. */
export interface RequestIds {
  newRequestId(): string;
}

/** A browser waiting for a request for an outside MCP client: the request, the account that asked, and the client's request to answer once it is decided. */
export interface Waiting {
  readonly fleetId: FleetId;
  readonly requestId: string;
  readonly accountId: string;
  /** The secret the browser that asked holds, so no other browser takes the client's code. */
  readonly browserSecret: string;
  readonly request: Readonly<Record<string, string | undefined>>;
}

/**
 * Outbound port: seals a waiting into the waiting page's address, so the
 * gateway stores nothing more than the request, and the browser's secret
 * stays secret on the way.
 */
export interface WaitingSeals {
  seal(waiting: Waiting): string;
  /** The waiting a sealed address holds; none for one the gateway did not seal. */
  open(sealed: string): Waiting | undefined;
}

/** An outcome of a request for an outside MCP server, to tell one requester by a message to their person ship (decision 0056). */
export interface OutcomeNotice {
  readonly fleetId: FleetId;
  readonly requestId: string;
  readonly accountId: string;
  readonly personShipId: ShipId;
  readonly url: string;
  readonly outcome: 'approved' | 'denied' | 'expired';
  /** The outside party the server is, once approved. */
  readonly partyName: string | null;
}

/** Outbound port: the outcomes still to tell, kept until the fleet stored the message or refused it. */
export interface OutcomeNotices {
  /** The outcomes not ended yet, in every fleet, the oldest first. */
  listUnended(limit: number): Promise<OutcomeNotice[]>;
  /** Ends an outcome: told, or refused by the fleet. */
  end(notice: Pick<OutcomeNotice, 'fleetId' | 'requestId' | 'accountId'>): Promise<void>;
}

/** The gateway's question to its owner about one request (decision 0056): asked once, withdrawn once the request ended. */
export interface OwnerQuestion {
  readonly fleetId: FleetId;
  readonly requestId: string;
  /** The question's own uuid (decision 0038), the same each time it is sent. */
  readonly questionId: string;
  /** The ship asked; null before it is asked, or when the fleet refused the question. */
  readonly askedShipId: ShipId | null;
  readonly askedAt: Date | null;
  readonly withdrawnAt: Date | null;
}

/** Outbound port: the gateway's questions to its owner, beside the requests they are about. */
export interface OwnerQuestions {
  /** The open requests, not expired by now, in every fleet, whose question is not asked yet, with its id once kept. */
  listToAsk(now: Date, limit: number): Promise<{ request: PendingRequest; questionId: string | null }[]>;
  /** Keeps the request's question with this id, unless it has one: the id it keeps. */
  keep(fleetId: FleetId, question: { requestId: string; questionId: string }): Promise<string>;
  /** Marks the question asked of a ship, or, with none, given up after the fleet refused it. */
  markAsked(fleetId: FleetId, asked: { requestId: string; askedShipId: ShipId | null; at: Date }): Promise<void>;
  /** The questions asked of a ship and not withdrawn whose request ended by now, in every fleet. */
  listToWithdraw(now: Date, limit: number): Promise<OwnerQuestion[]>;
  markWithdrawn(fleetId: FleetId, withdrawn: { requestId: string; at: Date }): Promise<void>;
}

/** Outbound port: who owns a ship (decision 0045), as the fleet answers it. */
export interface Owners {
  ownerOf(crewToken: string, shipId: ShipId): Promise<Result<ShipId | null, FleetRefusal>>;
}
