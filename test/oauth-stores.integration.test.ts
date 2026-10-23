import type { FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaAuthorizationCodes, createPrismaIssuedTokens, createPrismaOAuthClients } from '../src/adapters/prisma/oauth-stores.js';
import type { TokenHolder, TokenPair } from '../src/core/oauth/ports.js';
import { migratedDatabase } from './support/database.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const AT = new Date('2026-10-19T09:00:00.000Z');
const LATER = new Date('2026-10-19T10:00:00.000Z');

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
});

afterAll(async () => {
  await prisma.$disconnect();
});

function aPair(overrides: Partial<Pick<TokenPair, 'familyId' | 'codeHash' | 'fleetId' | 'accessHash' | 'refreshHash' | 'refreshExpiresAt'>> = {}, holder: TokenHolder = { kind: 'party', party: 'claude' }): TokenPair {
  return { familyId: 'family-1', codeHash: 'code-1', fleetId: FLEET, clientId: 'client-1', resource: 'http://gateway.example.com/mcp', scope: null, ...holder, accessHash: 'access-1', accessExpiresAt: AT, refreshHash: 'refresh-1', refreshExpiresAt: LATER, ...overrides };
}

describe("the gateway's OAuth records in Postgres", () => {
  it('keeps a pre-registered client', async () => {
    const clients = createPrismaOAuthClients(prisma);
    const client = { clientId: 'client-cursor', fleetId: FLEET, name: 'Cursor', redirectUris: ['https://cursor.example.com/callback'], secretHash: 'hash', grant: 'authorizationCode' } as const;
    await clients.save(client);

    await expect(clients.find('client-cursor')).resolves.toEqual(client);
  });

  it('keeps a client that signs in by client credentials, with no redirect URI, and its new secret (vendor platforms V4, V8)', async () => {
    const clients = createPrismaOAuthClients(prisma);
    const client = { clientId: 'client-agentcore', fleetId: FLEET, name: 'agentcore', redirectUris: [], secretHash: 'hash-1', grant: 'clientCredentials' } as const;
    await clients.save(client);
    await clients.save({ ...client, secretHash: 'hash-2' });

    await expect(clients.find('client-agentcore')).resolves.toEqual({ ...client, secretHash: 'hash-2' });
  });

  it('keeps an access token issued from no code and with no refresh token', async () => {
    const tokens = createPrismaIssuedTokens(prisma);
    const token = aPair({ familyId: 'access-cc', codeHash: null, accessHash: 'access-cc', refreshHash: null, refreshExpiresAt: null });
    await tokens.save(token);

    await expect(tokens.findByAccess('access-cc')).resolves.toEqual({ ...token, state: 'active' });
  });

  it('hands a code to one of two racing takes; the other reads it used', async () => {
    const codes = createPrismaAuthorizationCodes(prisma);
    await codes.save({ codeHash: 'race', fleetId: FLEET, clientId: 'client-1', redirectUri: 'https://x.example/cb', codeChallenge: 'c', resource: 'r', scope: null, kind: 'party', party: 'claude', expiresAt: AT });

    const takes = await Promise.all([codes.take('race'), codes.take('race')]);

    expect(takes.map((taken) => taken?.wasUsed).sort()).toEqual([false, true]);
    expect(takes[0]?.code).toMatchObject({ kind: 'party', party: 'claude' });
    await expect(codes.take('none')).resolves.toBeUndefined();
  });

  it('rotates a pair once under a race, and revokes by family and by code', async () => {
    const tokens = createPrismaIssuedTokens(prisma);
    await tokens.save(aPair());
    await tokens.save(aPair({ familyId: 'family-2', codeHash: 'code-2', accessHash: 'access-2', refreshHash: 'refresh-2' }));

    await expect(Promise.all([tokens.rotate('refresh-1'), tokens.rotate('refresh-1')]).then((rotated) => rotated.sort())).resolves.toEqual([false, true]);
    await tokens.revokeFamily('family-1');
    await tokens.revokeIssuedBy('code-2');

    await expect(Promise.all([tokens.findByAccess('access-1'), tokens.findByRefresh('refresh-2')]).then((pairs) => pairs.map((pair) => pair?.state))).resolves.toEqual(['revoked', 'revoked']);
  });

  it('reads a pair by its access token as it was kept', async () => {
    const tokens = createPrismaIssuedTokens(prisma);
    await tokens.save(aPair({ familyId: 'family-3', accessHash: 'access-3', refreshHash: 'refresh-3' }));

    await expect(tokens.findByAccess('access-3')).resolves.toEqual({ ...aPair({ familyId: 'family-3', accessHash: 'access-3', refreshHash: 'refresh-3' }), state: 'active' });
  });

  it("keeps a code and a pair for a signed-in account's grant (decision 0054)", async () => {
    const codes = createPrismaAuthorizationCodes(prisma);
    const tokens = createPrismaIssuedTokens(prisma);
    await codes.save({ codeHash: 'account-code', fleetId: FLEET, clientId: 'client-1', redirectUri: 'https://x.example/cb', codeChallenge: 'c', resource: 'r', scope: null, kind: 'account', grantId: 'grant-1', expiresAt: AT });
    await tokens.save(aPair({ familyId: 'family-a', accessHash: 'access-a', refreshHash: 'refresh-a' }, { kind: 'account', grantId: 'grant-1' }));

    await expect(codes.take('account-code')).resolves.toMatchObject({ code: { kind: 'account', grantId: 'grant-1' } });
    await expect(tokens.findByAccess('access-a')).resolves.toEqual({ ...aPair({ familyId: 'family-a', accessHash: 'access-a', refreshHash: 'refresh-a' }, { kind: 'account', grantId: 'grant-1' }), state: 'active' });
  });

  it("revokes the tokens of an account grant, in its fleet, and no other's", async () => {
    const tokens = createPrismaIssuedTokens(prisma);
    await tokens.save(aPair({ familyId: 'family-g1', accessHash: 'access-g1', refreshHash: 'refresh-g1' }, { kind: 'account', grantId: 'grant-9' }));
    await tokens.save(aPair({ familyId: 'family-g2', accessHash: 'access-g2', refreshHash: 'refresh-g2' }, { kind: 'account', grantId: 'grant-8' }));
    await tokens.save(aPair({ fleetId: OTHER_FLEET, familyId: 'family-g3', accessHash: 'access-g3', refreshHash: 'refresh-g3' }, { kind: 'account', grantId: 'grant-9' }));

    await tokens.revokeGrant(FLEET, 'grant-9');

    await expect(Promise.all(['access-g1', 'access-g2', 'access-g3'].map(async (hash) => (await tokens.findByAccess(hash))?.state))).resolves.toEqual(['revoked', 'active', 'active']);
  });

  it("revokes the tokens of a party, in its fleet, and no other's", async () => {
    const tokens = createPrismaIssuedTokens(prisma);
    await tokens.save(aPair({ familyId: 'family-p1', accessHash: 'access-p1', refreshHash: 'refresh-p1' }, { kind: 'party', party: 'orderbot' }));
    await tokens.save(aPair({ familyId: 'family-p2', accessHash: 'access-p2', refreshHash: 'refresh-p2' }, { kind: 'party', party: 'claude' }));
    await tokens.save(aPair({ fleetId: OTHER_FLEET, familyId: 'family-p3', accessHash: 'access-p3', refreshHash: 'refresh-p3' }, { kind: 'party', party: 'orderbot' }));

    await tokens.revokeParty(FLEET, 'orderbot');

    await expect(Promise.all(['access-p1', 'access-p2', 'access-p3'].map(async (hash) => (await tokens.findByAccess(hash))?.state))).resolves.toEqual(['revoked', 'active', 'active']);
  });

  it("forgets a fleet with its clients, codes and tokens (decision 0021)", async () => {
    const clients = createPrismaOAuthClients(prisma);
    const tokens = createPrismaIssuedTokens(prisma);
    await clients.save({ clientId: 'client-other', fleetId: OTHER_FLEET, name: 'Other', redirectUris: ['https://o.example/cb'], secretHash: null, grant: 'authorizationCode' });
    await tokens.save(aPair({ fleetId: OTHER_FLEET, familyId: 'family-o', accessHash: 'access-o', refreshHash: 'refresh-o' }));

    await createPrismaFleetForgetter(prisma).forget(OTHER_FLEET);

    await expect(Promise.all([clients.find('client-other'), tokens.findByAccess('access-o')])).resolves.toEqual([undefined, undefined]);
  });
});
