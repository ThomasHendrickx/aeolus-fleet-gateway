/**
 * The OAuth server's records: pre-registered clients, codes and token pairs,
 * every secret kept only as its hash. Taking a code and rotating a pair are
 * one conditional update each, so of two racing calls only one wins.
 */
import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { AuthorizationCodes, IssuedTokens, OAuthClients, TokenPair, TokenState } from '../../core/oauth/ports.js';
import type { Db } from './client.js';

const tokenStateSchema: z.ZodType<TokenState> = z.enum(['active', 'rotated', 'revoked']);

export function createPrismaOAuthClients(db: Db): OAuthClients {
  return {
    find: async (clientId) => {
      const row = await db.oAuthClient.findUnique({ where: { clientId } });
      return row ? { ...row, fleetId: idSchema('fleet').parse(row.fleetId) } : undefined;
    },
    save: async (client) => {
      const columns = { fleetId: client.fleetId, name: client.name, redirectUris: [...client.redirectUris], secretHash: client.secretHash };
      await db.oAuthClient.upsert({ where: { clientId: client.clientId }, create: { clientId: client.clientId, ...columns }, update: columns });
    },
  };
}

export function createPrismaAuthorizationCodes(db: Db): AuthorizationCodes {
  return {
    save: async (code) => {
      await db.authorizationCode.create({ data: { ...code } });
    },
    take: async (codeHash) => {
      const marked = await db.authorizationCode.updateMany({ where: { codeHash, usedAt: null }, data: { usedAt: new Date() } });
      const row = await db.authorizationCode.findUnique({ where: { codeHash } });
      if (!row) {
        return undefined;
      }
      const { codeHash: hash, clientId, redirectUri, codeChallenge, resource, scope, party, expiresAt } = row;
      return { code: { codeHash: hash, fleetId: idSchema('fleet').parse(row.fleetId), clientId, redirectUri, codeChallenge, resource, scope, party, expiresAt }, wasUsed: marked.count === 0 };
    },
  };
}

function pairOf(row: Omit<TokenPair, 'fleetId'> & { fleetId: string; state: string }): TokenPair & { state: TokenState } {
  return { ...row, fleetId: idSchema('fleet').parse(row.fleetId), state: tokenStateSchema.parse(row.state) };
}

export function createPrismaIssuedTokens(db: Db): IssuedTokens {
  return {
    save: async (pair) => {
      await db.issuedToken.create({ data: { ...pair, state: 'active' } });
    },
    findByAccess: async (accessHash) => {
      const row = await db.issuedToken.findUnique({ where: { accessHash } });
      return row ? pairOf(row) : undefined;
    },
    findByRefresh: async (refreshHash) => {
      const row = await db.issuedToken.findUnique({ where: { refreshHash } });
      return row ? pairOf(row) : undefined;
    },
    rotate: async (refreshHash) => (await db.issuedToken.updateMany({ where: { refreshHash, state: 'active' }, data: { state: 'rotated' } })).count === 1,
    revokeFamily: async (familyId) => {
      await db.issuedToken.updateMany({ where: { familyId }, data: { state: 'revoked' } });
    },
    revokeIssuedBy: async (codeHash) => {
      await db.issuedToken.updateMany({ where: { codeHash }, data: { state: 'revoked' } });
    },
  };
}
