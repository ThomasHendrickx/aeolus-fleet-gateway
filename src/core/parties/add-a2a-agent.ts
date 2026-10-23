import type { ShipId } from '@aeolus-fleet/common';

import type { Actor } from '../actors/authenticate-actor.js';
import type { AgentCards } from '../a2a-out/ports.js';
import { readAgentStatement } from '../a2a-out/read-agent-statement.js';
import type { CallTiming } from '../mcp-out/statement.js';
import { refuse, type DomainError } from '../shared/errors.js';
import type { Result } from '../shared/result.js';
import type { McpServerCredential } from '../vault/credential.js';
import { APPROVING_SCOPE, EVERY_APP_SHIP_SCOPES, scopeNotHeld } from './approver.js';
import { A2A_AGENT_SHIP_TYPE, approved, UNCOMMISSIONED, type ApprovalDeps, type ApprovePartyRefusal } from './approve-party.js';
import type { A2aAgentParty } from './party.js';
import type { ShownParty } from './shown-party.js';

export type AddA2aAgentRefusal = ApprovePartyRefusal | DomainError<'NOT_AN_APPROVER' | 'SCOPE_NOT_HELD' | 'CARD_UNREACHABLE' | 'CARD_INVALID'>;

export type AddA2aAgent = (input: {
  actor: Actor;
  requestId: string;
  name: string;
  cardUrl: string;
  credential: McpServerCredential;
  concurrencyLimit: number;
  ownerShipId: ShipId;
  scopes: readonly string[];
}) => Promise<Result<ShownParty, AddA2aAgentRefusal>>;

/**
 * Use case: an actor holding gateway:approve adds an outside A2A agent by
 * its card address (slice 5). The gateway reads the card first: one that
 * does not answer, is no AgentCard or makes no valid statement is not
 * added, and nothing is commissioned. Then it commissions and crews an
 * `a2a-agent` proxy ship with the owner and only scopes the approver holds,
 * as every approval does, keeps the credential in the vault, and writes the
 * card's domain as the fact it checked. The agent is repeatable, A2A's
 * default (A9). Its statement is written once its worker starts.
 */
export function createAddA2aAgent(deps: ApprovalDeps & { cards: AgentCards; timing: CallTiming }): AddA2aAgent {
  return async ({ actor, requestId, name, cardUrl, credential, concurrencyLimit, ownerShipId, scopes }) => {
    if (!actor.scopes.includes(APPROVING_SCOPE)) {
      return refuse('NOT_AN_APPROVER', `Adding an outside A2A agent needs ${APPROVING_SCOPE}`);
    }
    const notHeld = scopeNotHeld(actor, scopes);
    if (notHeld !== undefined) {
      return refuse('SCOPE_NOT_HELD', `You may grant only scopes you hold: not ${notHeld}`);
    }
    const { fleetId } = actor;
    if (!(await deps.servesOutsideParties(fleetId))) {
      return refuse('OUTSIDE_PARTIES_OFF', "This fleet's outside parties are off: turn them on first");
    }
    const statement = await readAgentStatement(deps, { name, cardUrl, isRepeatable: true });
    if (!statement.isOk) {
      return statement;
    }
    const granted = scopes.filter((scope) => !EVERY_APP_SHIP_SCOPES.has(scope));
    const requestHash = deps.hasher.hash(JSON.stringify([requestId, name, cardUrl, credential, concurrencyLimit, ownerShipId, granted]));
    return approved<A2aAgentParty>(deps, {
      fleetId,
      type: A2A_AGENT_SHIP_TYPE,
      scopes: granted,
      requestHash,
      owner: ownerShipId,
      party: ({ approvedAt }) => ({ fleetId, name, kind: 'a2aAgent', cardUrl, credential, concurrencyLimit, isRepeatable: true, ...UNCOMMISSIONED, requestId, requestHash, approvedAt }),
      isOwn: (earlier): earlier is A2aAgentParty => earlier.kind === 'a2aAgent',
    });
  };
}
