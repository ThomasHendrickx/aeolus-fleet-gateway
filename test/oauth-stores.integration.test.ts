import type { FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaAuthorizationCodes, createPrismaIssuedTokens, createPrismaOAuthClients } from '../src/adapters/prisma/oauth-stores.js';
import type { TokenPair } from '../src/core/oauth/ports.js';
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

function aPair(overrides: Partial<TokenPair> = {}): TokenPair {
  return { familyId: 'family-1', codeHash: 'code-1', fleetId: FLEET, clientId: 'client-1', resource: 'http://gateway.example.com/mcp', scope: null, party: 'claude', accessHash: 'access-1', accessExpiresAt: AT, refreshHash: 'refresh-1', refreshExpiresAt: LATER, ...overrides };
}

describe("the gateway's OAuth records in Postgres", () => {
  it('keeps a pre-registered client', async () => {
    const clients = createPrismaOAuthClients(prisma);
    const client = { clientId: 'client-cursor', fleetId: FLEET, name: 'Cursor', redirectUris: ['https://cursor.example.com/callback'], secretHash: 'hash' };
    await clients.save(client);

    await expect(clients.find('client-cursor')).resolves.toEqual(client);
  });

  it('hands a code to one of two racing takes; the other reads it used', async () => {
    const codes = createPrismaAuthorizationCodes(prisma);
    await codes.save({ codeHash: 'race', fleetId: FLEET, clientId: 'client-1', redirectUri: 'https://x.example/cb', codeChallenge: 'c', resource: 'r', scope: null, party: 'claude', expiresAt: AT });

    const takes = await Promise.all([codes.take('race'), codes.take('race')]);

    expect(takes.map((taken) => taken?.wasUsed).sort()).toEqual([false, true]);
    expect(takes[0]?.code.party).toBe('claude');
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

  it("forgets a fleet with its clients, codes and tokens (decision 0021)", async () => {
    const clients = createPrismaOAuthClients(prisma);
    const tokens = createPrismaIssuedTokens(prisma);
    await clients.save({ clientId: 'client-other', fleetId: OTHER_FLEET, name: 'Other', redirectUris: ['https://o.example/cb'], secretHash: null });
    await tokens.save(aPair({ fleetId: OTHER_FLEET, familyId: 'family-o', accessHash: 'access-o', refreshHash: 'refresh-o' }));

    await createPrismaFleetForgetter(prisma).forget(OTHER_FLEET);

    await expect(Promise.all([clients.find('client-other'), tokens.findByAccess('access-o')])).resolves.toEqual([undefined, undefined]);
  });
});
