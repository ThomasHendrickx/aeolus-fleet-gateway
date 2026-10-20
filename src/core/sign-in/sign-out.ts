import type { AccountGrants, PageSession } from './ports.js';

export type SignOut = (session: PageSession) => Promise<void>;

/**
 * Use case: a person signs out of the gateway's pages. The session's grant
 * ends, so a page session cookie kept after it is signed out; the account's
 * sign-ins from its MCP clients go on.
 */
export function createSignOut(deps: { grants: Pick<AccountGrants, 'end'> }): SignOut {
  return ({ fleetId, grantId }) => deps.grants.end(fleetId, grantId);
}
