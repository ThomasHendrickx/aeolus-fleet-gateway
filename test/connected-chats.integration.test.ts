import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaAccountGrants } from '../src/adapters/prisma/account-grants.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaConnectedChats } from '../src/adapters/prisma/connected-chats.js';
import { createPrismaIssuedTokens, createPrismaOAuthClients } from '../src/adapters/prisma/oauth-stores.js';
import type { TokenPair } from '../src/core/oauth/ports.js';
import { migratedDatabase } from './support/database.js';

// The chats connected through the gateway as a person ship (Bridge,
// section 8; the routing mockup): each MCP client signed in as the person
// ship, read from its account grants and their token pairs still active.

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const PERSON_SHIP: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8c1';
const OTHER_PERSON_SHIP: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8c2';
const ACCESS_UNTIL = new Date('2026-10-31T21:00:00.000Z');
const REFRESH_UNTIL = new Date('2026-11-30T20:00:00.000Z');

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function aClient({ clientId, name, fleetId = FLEET }: { clientId: string; name: string; fleetId?: FleetId }) {
  await createPrismaOAuthClients(prisma).save({ clientId, fleetId, name, redirectUris: ['https://chat.example/cb'], secretHash: null, grant: 'authorizationCode' });
}

async function aGrant({ grantId, personShipId, fleetId = FLEET }: { grantId: string; personShipId: ShipId | null; fleetId?: FleetId }) {
  await createPrismaAccountGrants(prisma).save({ grantId, fleetId, accountId: 'acc-thomas', personShipId, scopes: [], refreshToken: 'r', accountToken: 'a', accountTokenExpiresAt: ACCESS_UNTIL });
}

function aPair(pair: { family: string; clientId: string; grantId: string; fleetId?: FleetId; refreshExpiresAt?: Date | null }): TokenPair {
  const { family, clientId, grantId, fleetId = FLEET, refreshExpiresAt = REFRESH_UNTIL } = pair;
  return {
    familyId: family,
    codeHash: `code-${family}`,
    fleetId,
    clientId,
    resource: 'https://gateway.example/mcp',
    scope: null,
    kind: 'account',
    grantId,
    accessHash: `access-${family}`,
    accessExpiresAt: ACCESS_UNTIL,
    refreshHash: refreshExpiresAt === null ? null : `refresh-${family}`,
    refreshExpiresAt,
  };
}

describe('the chats connected as a person ship, in Postgres', () => {
  it('lists each active token pair of its grants with its client and until when it lives: the refresh token, else the access token', async () => {
    await aClient({ clientId: 'client-claude', name: 'claude.ai' });
    await aClient({ clientId: 'client-chatgpt', name: 'ChatGPT' });
    await aGrant({ grantId: 'grant-claude', personShipId: PERSON_SHIP });
    await aGrant({ grantId: 'grant-chatgpt', personShipId: PERSON_SHIP });
    const tokens = createPrismaIssuedTokens(prisma);
    await tokens.save(aPair({ family: 'claude-1', clientId: 'client-claude', grantId: 'grant-claude' }));
    await tokens.save(aPair({ family: 'chatgpt-1', clientId: 'client-chatgpt', grantId: 'grant-chatgpt', refreshExpiresAt: null }));

    const chats = await createPrismaConnectedChats(prisma).list(FLEET, PERSON_SHIP);

    expect(chats).toEqual(
      expect.arrayContaining([
        { name: 'claude.ai', liveUntil: REFRESH_UNTIL },
        { name: 'ChatGPT', liveUntil: ACCESS_UNTIL },
      ]),
    );
    expect(chats).toHaveLength(2);
  });

  it("leaves out a pair revoked or rotated, another person ship's and another fleet's", async () => {
    await aClient({ clientId: 'client-cursor', name: 'Cursor' });
    await aClient({ clientId: 'client-other', name: 'Other', fleetId: OTHER_FLEET });
    await aGrant({ grantId: 'grant-cursor', personShipId: PERSON_SHIP });
    await aGrant({ grantId: 'grant-someone', personShipId: OTHER_PERSON_SHIP });
    await aGrant({ grantId: 'grant-other-fleet', personShipId: PERSON_SHIP, fleetId: OTHER_FLEET });
    const tokens = createPrismaIssuedTokens(prisma);
    await tokens.save(aPair({ family: 'cursor-1', clientId: 'client-cursor', grantId: 'grant-cursor' }));
    await tokens.revokeFamily('cursor-1');
    await tokens.save(aPair({ family: 'someone-1', clientId: 'client-cursor', grantId: 'grant-someone' }));
    await tokens.save(aPair({ family: 'other-1', clientId: 'client-other', grantId: 'grant-other-fleet', fleetId: OTHER_FLEET }));

    const chats = await createPrismaConnectedChats(prisma).list(FLEET, PERSON_SHIP);

    expect(chats.map(({ name }) => name)).not.toEqual(expect.arrayContaining(['Cursor']));
    expect(chats.map(({ name }) => name)).not.toEqual(expect.arrayContaining(['Other']));
  });
});
