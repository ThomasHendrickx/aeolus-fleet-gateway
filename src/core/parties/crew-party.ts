import type { FleetId } from '@aeolus-fleet/common';

import type { FleetDoor } from '../connection/ports.js';
import type { IssuedTokens, OAuthClients, OAuthSecrets } from '../oauth/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { shownPartyOf, type ShownParty } from './shown-party.js';
import type { Party } from './party.js';
import type { PartyStore, ProxyShipDoor } from './ports.js';

/** The fleet's codes for a crew token it no longer takes: the ship's crew was released. */
const CREW_ENDED = new Set(['LEASE_ENDED', 'UNAUTHORIZED']);

/** A party crewed again, with its new client secret, answered once, where its client signs in by client credentials. */
export interface CrewedParty {
  readonly party: ShownParty;
  readonly clientSecret: string | null;
}

export type CrewParty = (input: { operatorFleetId: FleetId; name: string; secret: string }) => Promise<
  Result<CrewedParty, DomainError<'NO_SUCH_PARTY' | 'NOT_AWAITING_CREW' | 'SECRET_REFUSED' | 'FLEET_UNAVAILABLE'>>
>;

/**
 * Use case: argo hands over a new secret for a party's proxy ship that awaits
 * crew, taken from a new starting prompt in the console: the commission's
 * answer was lost, and its secret with it, and the gateway's ship may not ask
 * for a new one (orchestrator-1 on aeolus-fleet#876, Q6); or its crew was
 * released, which the fleet tells by no longer taking the party's crew token
 * (vendor platforms V8). The gateway crews the same ship with it and keeps
 * the crew token; the secret is never kept. A client that signs in by client
 * credentials gets a new client secret, answered once, in place of the old
 * one, and the tokens the old one gave are revoked.
 */
export function createCrewParty(deps: {
  parties: PartyStore;
  door: ProxyShipDoor & Pick<FleetDoor, 'whoami'>;
  clients: OAuthClients;
  secrets: OAuthSecrets;
  tokens: Pick<IssuedTokens, 'revokeParty'>;
}): CrewParty {
  /** Whether the ship awaits crew: never crewed by the gateway, or the fleet no longer takes its crew token. */
  const isAwaitingCrew = async (party: Party): Promise<Result<boolean, DomainError<'FLEET_UNAVAILABLE'>>> => {
    if (party.state !== 'crewed' || party.crewToken === null) {
      return ok(party.state === 'awaitingCrew');
    }
    const who = await deps.door.whoami(party.crewToken);
    if (!who.isOk && who.error.code === 'UNAVAILABLE') {
      return refuse('FLEET_UNAVAILABLE', `The fleet did not answer: ${who.error.message}`);
    }
    return ok(!who.isOk && CREW_ENDED.has(who.error.code));
  };

  /** The client's new secret, if it signs in by client credentials, kept only as its hash. */
  const newClientSecret = async (party: Party): Promise<string | null> => {
    const client = party.kind === 'mcpClient' ? await deps.clients.find(party.clientId) : undefined;
    if (client?.grant !== 'clientCredentials') {
      return null;
    }
    const clientSecret = deps.secrets.newSecret();
    await deps.clients.save({ ...client, secretHash: deps.secrets.hashOf(clientSecret) });
    await deps.tokens.revokeParty(party.fleetId, party.name);
    return clientSecret;
  };

  return async ({ operatorFleetId, name, secret }) => {
    const party = await deps.parties.find(operatorFleetId, name);
    if (!party) {
      return refuse('NO_SUCH_PARTY', `No party named ${name}`);
    }
    const awaiting = await isAwaitingCrew(party);
    if (!awaiting.isOk) {
      return awaiting;
    }
    if (!awaiting.value || party.proxyShipId === null) {
      return refuse('NOT_AWAITING_CREW', `The proxy ship of ${name} does not await crew`);
    }
    const registered = await deps.door.register({ shipId: party.proxyShipId, secret });
    if (!registered.isOk) {
      return refuse('SECRET_REFUSED', `The fleet refused the secret: ${registered.error.message}`);
    }
    const crewed: Party = { ...party, state: 'crewed', secret: null, crewToken: registered.value.crewToken };
    await deps.parties.save(crewed);
    return ok({ party: shownPartyOf(crewed), clientSecret: await newClientSecret(crewed) });
  };
}
