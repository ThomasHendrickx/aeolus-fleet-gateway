import type { FleetId } from '@aeolus-fleet/common';

import type { PartyStore } from '../parties/ports.js';
import type { GrantCaller } from '../people/person-crew.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { AccountGrants } from '../sign-in/ports.js';
import type { OpenRequest } from './open-request.js';
import type { RequestState } from './ports.js';

/** What asking answers the person: their request, by its id, and until when it waits. */
export interface AskedServer {
  readonly requestId: string;
  readonly url: string;
  readonly state: RequestState;
  readonly expiresAt: Date;
}

export type AskForServer = (asked: { caller: GrantCaller; url: string }) => Promise<
  Result<AskedServer, DomainError<'INVALID_SERVER_URL' | 'OUTSIDE_PARTIES_OFF' | 'SIGNED_OUT' | 'PARTY_EXISTS'>>
>;

/** The server's address as a URL reads it, so one server written two ways is one request; none for an address that is not http or https. */
function serverUrlOf(text: string): string | undefined {
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Use case: a signed-in person asks for an outside MCP server, as their
 * account (decision 0056). An outside MCP server never asks itself: an
 * approver adds it, giving its credential. A second person asking for the
 * same server joins the request pending. While the fleet's outside parties
 * are off, nobody asks (interop I-3).
 */
export function createAskForServer(deps: { grants: AccountGrants; parties: PartyStore; openRequest: OpenRequest; servesOutsideParties: (fleetId: FleetId) => Promise<boolean> }): AskForServer {
  return async ({ caller, url: written }) => {
    const url = serverUrlOf(written);
    if (url === undefined) {
      return refuse('INVALID_SERVER_URL', `${written} is no address of an MCP server: give its https URL`);
    }
    const { fleetId } = caller;
    if (!(await deps.servesOutsideParties(fleetId))) {
      return refuse('OUTSIDE_PARTIES_OFF', "This fleet's outside parties are off: nobody asks for an outside MCP server");
    }
    const grant = await deps.grants.find(fleetId, caller.grantId);
    if (grant === undefined) {
      return refuse('SIGNED_OUT', 'Your sign-in ended: sign in again from your MCP client');
    }
    const party = (await deps.parties.list(fleetId)).find((each) => each.kind === 'mcpServer' && each.url === url);
    if (party !== undefined) {
      return refuse('PARTY_EXISTS', `${url} is the outside party ${party.name} already`);
    }
    const request = await deps.openRequest({ fleetId, subject: { kind: 'server', url }, requester: { accountId: grant.accountId, personShipId: grant.personShipId } });
    return ok({ requestId: request.requestId, url, state: request.state, expiresAt: request.expiresAt });
  };
}
