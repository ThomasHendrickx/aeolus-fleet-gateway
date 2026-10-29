import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { memoryIssuedTokens } from '../../../test/support/oauth-fakes.js';
import { memoryAccountGrants, PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import type { AccountGrant } from './ports.js';
import { createEndSignIns } from './end-sign-ins.js';

// pagasae disables a leaver's account and tells the gateway, which ends
// that account's gateway tokens there (decision 0055, flow F8): every
// sign-in of it in the fleet ends, and its clients' tokens are revoked.

const NOW = new Date('2026-10-20T10:00:00.000Z');

let grants: ReturnType<typeof memoryAccountGrants>;
let tokens: ReturnType<typeof memoryIssuedTokens>;

function aGrant(overrides: Partial<AccountGrant>): AccountGrant {
  return { grantId: 'grant-1', fleetId: FLEET_ID, accountId: 'acc-burak', personShipId: PERSON_SHIP_ID, scopes: [], refreshToken: 'pagasae-refresh', accountToken: 'account-token', accountTokenExpiresAt: NOW, ...overrides };
}

async function signedIn(grant: AccountGrant, accessHash: string): Promise<void> {
  await grants.save(grant);
  await tokens.save({ familyId: `family-${accessHash}`, codeHash: `code-${accessHash}`, fleetId: grant.fleetId, clientId: 'client-1', resource: 'http://gateway.example.com/mcp', scope: null, accessExpiresAt: NOW, refreshExpiresAt: NOW, kind: 'account', grantId: grant.grantId, accessHash, refreshHash: `refresh-${accessHash}` });
}

function endSignIns() {
  return createEndSignIns({ grants, tokens });
}

function tokenStates(): Record<string, string> {
  return Object.fromEntries(tokens.held.map(({ accessHash, state }) => [accessHash, state]));
}

beforeEach(async () => {
  grants = memoryAccountGrants();
  tokens = memoryIssuedTokens();
  await signedIn(aGrant({ grantId: 'grant-1' }), 'burak-claude');
  await signedIn(aGrant({ grantId: 'grant-2' }), 'burak-cursor');
  await signedIn(aGrant({ grantId: 'grant-3', accountId: 'acc-charlotte' }), 'charlotte-claude');
  await signedIn(aGrant({ grantId: 'grant-4', fleetId: OTHER_FLEET_ID }), 'burak-other-fleet');
});

describe("a disabled account's sign-ins at the gateway (decision 0055)", () => {
  it('ends every sign-in of the account in the fleet, revoking its clients\' tokens', async () => {
    await endSignIns()({ fleetId: FLEET_ID, accountId: 'acc-burak' });

    expect({ grants: grants.held.map(({ grantId }) => grantId), tokens: tokenStates() }).toEqual({
      grants: ['grant-3', 'grant-4'],
      tokens: { 'burak-claude': 'revoked', 'burak-cursor': 'revoked', 'charlotte-claude': 'active', 'burak-other-fleet': 'active' },
    });
  });

  it('ends nothing more when told again, or for an account with no sign-in', async () => {
    await endSignIns()({ fleetId: FLEET_ID, accountId: 'acc-burak' });

    await endSignIns()({ fleetId: FLEET_ID, accountId: 'acc-burak' });
    await endSignIns()({ fleetId: FLEET_ID, accountId: 'acc-nobody' });

    expect({ grants: grants.held.map(({ grantId }) => grantId), active: Object.values(tokenStates()).filter((state) => state === 'active').length }).toEqual({ grants: ['grant-3', 'grant-4'], active: 2 });
  });
});
