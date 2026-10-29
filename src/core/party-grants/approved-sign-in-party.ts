import type { ActorCredential } from '../actors/credential-of.js';
import type { ApprovingDeps, ApprovingRefusal, CheckApproving } from '../parties/check-approving.js';
import { approvedParty } from '../parties/check-approving.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { SignInClient } from '../vault/credential.js';

export type ApprovedSignInPartyRefusal = ApprovingRefusal | DomainError<'NO_SIGN_IN'>;

/**
 * The outside MCP server where each person signs in whose grants an approver
 * sees and removes (decision 0067, Q6, Q12): the actor holds gateway:approve
 * within manage reach of its proxy ship, as the fleet answers; its name and
 * client, and the actor's credential to read the fleet as.
 */
export async function approvedSignInParty(deps: ApprovingDeps, asked: Parameters<CheckApproving>[0]): Promise<Result<{ name: string; client: SignInClient; credential: ActorCredential }, ApprovedSignInPartyRefusal>> {
  const approved = await approvedParty(deps, asked);
  if (!approved.isOk) {
    return approved;
  }
  const { party, credential } = approved.value;
  if (party.kind !== 'mcpServer' || party.credential.kind !== 'personSignIn') {
    return refuse('NO_SIGN_IN', `Nobody signs in to ${party.name} for themselves: the gateway calls it with its own credential`);
  }
  return ok({ name: party.name, client: party.credential.client, credential });
}
