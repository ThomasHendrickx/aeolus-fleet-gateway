import { randomUUID } from 'node:crypto';

import { readOf, type SignedInPage } from '../../../lib/gateway-api/page-api';
import { EVERY_APP_SHIP_SCOPES } from '../../outside-party/scope-changes';
import { A2aClientForm } from './a2a-client-form';

/**
 * Adding an outside A2A client (decision 0060): an approver names it, picks
 * its owner and ticks scopes it holds itself. One request id per page, so
 * sending again after a lost answer commissions no second proxy ship.
 */
export async function AddA2aClient({ page }: { page: SignedInPage }) {
  const { api, fleetId, scopes } = page;
  const [owners, listed] = await Promise.all([readOf(api.parties.ownerChoices.query()), readOf(api.parties.listedScopes.query())]);
  const grantable = scopes.filter((scope) => !EVERY_APP_SHIP_SCOPES.includes(scope));
  return <A2aClientForm fleetId={fleetId} requestId={randomUUID()} owners={owners} scopes={grantable} listed={listed.isOk ? listed.value.scopes : []} scopeRefusal={listed.isOk ? undefined : listed.refusal} />;
}
