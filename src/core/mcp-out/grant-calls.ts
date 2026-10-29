import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { CallGrantOf, CallPerson } from '../party-grants/call-grant.js';
import { isNearItsEnd, isUsable, type PartyGrant } from '../party-grants/party-grant.js';
import type { PartyGrants } from '../party-grants/ports.js';
import type { RefreshGrant } from '../party-grants/refresh-grant.js';
import type { PageUrlOf, TellSignInNeeded } from '../party-grants/tell-sign-in-needed.js';
import type { Clock } from '../shared/clock.js';
import type { SignInClient } from '../vault/credential.js';
import type { McpServers, ToolCall, ToolCallOutcome, ToolResult } from './ports.js';

/** A server where each person signs in, as a call to it goes out: where it is and the party's client. */
export interface SignInServerCalled {
  readonly fleetId: FleetId;
  readonly name: string;
  readonly url: string;
  readonly client: SignInClient;
}

/** A call about to go out under a person's grant. */
export interface GrantedCall {
  readonly server: SignInServerCalled;
  readonly grant: PartyGrant;
  readonly person: CallPerson;
}

/**
 * The grant a call goes out under, read at hand-over:
 * - granted: the asking ship's owner's;
 * - refused: none, so the call is answered at once with this error result and reaches no server (Q5, Q10);
 * - unread: core did not answer the owner read, so the call waits and is tried again.
 */
export type GrantFound = { readonly kind: 'granted'; readonly granted: GrantedCall } | { readonly kind: 'refused'; readonly result: ToolResult } | { readonly kind: 'unread' };

/** A call to a server where each person signs in, under its asking ship's owner's grant (decision 0067). */
export interface GrantCalls {
  grantOf(call: { server: SignInServerCalled; senderShipId: ShipId }): Promise<GrantFound>;
  /** Calls the tool under the grant; an outcome the gateway answers in the server's place is an answered error result. */
  callUnder(granted: GrantedCall, call: ToolCall): Promise<ToolCallOutcome>;
}

function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/**
 * The calls to a server where each person signs in (decision 0067): each
 * goes out with the access token of the person who owns the asking ship
 * (Q1, Q11), its grant refreshed first when its access token is near its
 * end (Q7). A person with no grant, or a lost one, gets Q5's error result naming the page
 * to sign in on, and is told once (Q6, Q9); a ship argo owns gets Q10's. A
 * call the server refuses 401 refreshes the grant once and goes out again;
 * a second 401, a refresh refused, or a grant removed meanwhile, answers
 * Q5's error result and tells the person. A refresh the authorization
 * server did not answer leaves the call unsent, to be handed again. A call
 * refused 403 `insufficient_scope` answers an error result naming the page
 * to sign in again on, keeping the grant (Q8). A call the server answered
 * sets when the grant was last used.
 */
export function createGrantCalls(deps: {
  callGrantOf: CallGrantOf;
  refreshGrant: RefreshGrant;
  tellSignInNeeded: TellSignInNeeded;
  servers: Pick<McpServers, 'callTool'>;
  grants: Pick<PartyGrants, 'markUsed'>;
  clock: Clock;
  pageUrlOf: PageUrlOf;
}): GrantCalls {
  const noWorkingSignIn = async (server: SignInServerCalled, person: CallPerson): Promise<ToolResult> => {
    await deps.tellSignInNeeded({ fleetId: server.fleetId, party: server.name, personShipId: person.shipId, lost: null });
    return errorResult(`${person.name}, who owns the calling ship, has no working sign-in to ${server.name}: sign in on ${deps.pageUrlOf(server.fleetId, server.name)}, then call again.`);
  };
  const answered = (result: ToolResult): ToolCallOutcome => ({ kind: 'answered', result });

  /** The grant refreshed ahead of its access token's end (Q7); where the refresh fails, the token held while it has not ended, else the call's outcome now. */
  const refreshedAhead = async (granted: GrantedCall): Promise<{ kind: 'granted'; granted: GrantedCall } | { kind: 'outcome'; outcome: ToolCallOutcome }> => {
    const now = deps.clock.now();
    if (!isNearItsEnd(granted.grant, now)) {
      return { kind: 'granted', granted };
    }
    const refreshed = await deps.refreshGrant({ client: granted.server.client, grant: granted.grant });
    if (refreshed.isOk) {
      return { kind: 'granted', granted: { ...granted, grant: refreshed.value } };
    }
    const isHeldTokenUsable = isUsable(granted.grant, now);
    switch (refreshed.error.kind) {
      case 'unreachable':
        return isHeldTokenUsable ? { kind: 'granted', granted } : { kind: 'outcome', outcome: { kind: 'notSent', reason: `The grant was not refreshed: ${refreshed.error.reason}` } };
      case 'noRefreshToken':
      case 'refused':
        return isHeldTokenUsable ? { kind: 'granted', granted } : { kind: 'outcome', outcome: answered(await noWorkingSignIn(granted.server, granted.person)) };
      case 'lost':
      case 'removed':
        return { kind: 'outcome', outcome: answered(await noWorkingSignIn(granted.server, granted.person)) };
    }
  };

  const callWith = async ({ server, grant, person }: GrantedCall, call: ToolCall): Promise<ToolCallOutcome> => {
    const outcome = await deps.servers.callTool({ url: server.url, credential: { kind: 'bearer', token: grant.accessToken } }, call);
    if (outcome.kind === 'answered') {
      await deps.grants.markUsed(grant, deps.clock.now());
    }
    if (outcome.kind === 'notSent' && outcome.refusal === 'insufficientScope') {
      return answered(
        errorResult(`${server.name} refused the call: the sign-in of ${person.name}, who owns the calling ship, lacks a scope it needs. Sign in again on ${deps.pageUrlOf(server.fleetId, server.name)}, then call again.`),
      );
    }
    return outcome;
  };

  return {
    async grantOf({ server, senderShipId }) {
      const found = await deps.callGrantOf({ fleetId: server.fleetId, party: server.name, senderShipId });
      switch (found.kind) {
        case 'unread':
          return { kind: 'unread' };
        case 'noPerson':
          return { kind: 'refused', result: errorResult(`No person can sign in to ${server.name} for ${found.shipName}, which argo owns: it calls ${server.name} once a person owns it.`) };
        case 'notSignedIn':
          return { kind: 'refused', result: await noWorkingSignIn(server, found.person) };
        case 'grant':
          return { kind: 'granted', granted: { server, grant: found.grant, person: found.person } };
      }
    },

    async callUnder(asGranted, call) {
      const ahead = await refreshedAhead(asGranted);
      if (ahead.kind === 'outcome') {
        return ahead.outcome;
      }
      const { granted } = ahead;
      const outcome = await callWith(granted, call);
      if (outcome.kind !== 'notSent' || outcome.refusal !== 'unauthorized') {
        return outcome;
      }
      const refreshed = await deps.refreshGrant({ client: granted.server.client, grant: granted.grant });
      if (!refreshed.isOk) {
        switch (refreshed.error.kind) {
          case 'unreachable':
            return { kind: 'notSent', reason: `The grant was not refreshed: ${refreshed.error.reason}` };
          case 'noRefreshToken':
          case 'refused':
          case 'lost':
          case 'removed':
            return answered(await noWorkingSignIn(granted.server, granted.person));
        }
      }
      const again = await callWith({ ...granted, grant: refreshed.value }, call);
      return again.kind === 'notSent' && again.refusal === 'unauthorized' ? answered(await noWorkingSignIn(granted.server, granted.person)) : again;
    },
  };
}
