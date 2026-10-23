import { randomUUID } from 'node:crypto';

import { readOf, type SignedInPage } from '../../../lib/gateway-api/page-api';
import { EVERY_APP_SHIP_SCOPES } from '../../outside-party/scope-changes';
import { A2aAgentForm } from './a2a-agent-form';

/**
 * Adding an outside A2A agent by its card address (slice 5): an approver
 * names it, types its card address and credential, picks its owner and
 * ticks scopes it holds itself. One request id per page, so sending again
 * after a lost answer commissions no second proxy ship.
 */
export async function AddA2aAgent({ page }: { page: SignedInPage }) {
  const { api, fleetId, scopes } = page;
  const owners = await readOf(api.parties.ownerChoices.query());
  const grantable = scopes.filter((scope) => !EVERY_APP_SHIP_SCOPES.includes(scope));
  return <A2aAgentForm fleetId={fleetId} requestId={randomUUID()} owners={owners} scopes={grantable} />;
}
