/**
 * The OAuth server's records: pre-registered clients, codes and token pairs,
 * every secret kept only as its hash. Taking a code and rotating a pair are
 * one conditional update each, so of two racing calls only one wins.
 */
import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { AuthorizationCodes, ClientGrant, IssuedTokens, OAuthClients, TokenHolder, TokenPair, TokenState } from '../../core/oauth/ports.js';
import type { Db } from './client.js';

const tokenStateSchema: z.ZodType<TokenState> = z.enum(['active', 'rotated', 'revoked']);
const clientGrantSchema: z.ZodType<ClientGrant> = z.enum(['authorizationCode', 'clientCredentials']);

/** The columns a holder is kept in: its party, or its account grant. */
function holderColumns(holder: TokenHolder): { party: string | null; grantId: string | null } {
  return holder.kind === 'party' ? { party: holder.party, grantId: null } : { party: null, grantId: holder.grantId };
}

/** The holder a row keeps; the table's check holds exactly one of the two. */
function holderOfRow(row: { party: string | null; grantId: string | null }): TokenHolder {
  if (row.party !== null) {
    return { kind: 'party', party: row.party };
  }
  if (row.grantId !== null) {
    return { kind: 'account', grantId: row.grantId };
  }
  throw new Error('A code or token row holds neither a party nor an account grant');
}

export function createPrismaOAuthClients(db: Db): OAuthClients {
  return {
    find: async (clientId) => {
      const row = await db.oAuthClient.findUnique({ where: { clientId } });
      return row ? { ...row, fleetId: idSchema('fleet').parse(row.fleetId), grant: clientGrantSchema.parse(row.grant) } : undefined;
    },
    save: async (client) => {
      const columns = { fleetId: client.fleetId, name: client.name, redirectUris: [...client.redirectUris], secretHash: client.secretHash, grant: client.grant };
      await db.oAuthClient.upsert({ where: { clientId: client.clientId }, create: { clientId: client.clientId, ...columns }, update: columns });
    },
  };
}

export function createPrismaAuthorizationCodes(db: Db): AuthorizationCodes {
  return {
    save: async (code) => {
      const { codeHash, fleetId, clientId, redirectUri, codeChallenge, resource, scope, expiresAt } = code;
      await db.authorizationCode.create({ data: { codeHash, fleetId, clientId, redirectUri, codeChallenge, resource, scope, expiresAt, ...holderColumns(code) } });
    },
    take: async (codeHash) => {
      const marked = await db.authorizationCode.updateMany({ where: { codeHash, usedAt: null }, data: { usedAt: new Date() } });
      const row = await db.authorizationCode.findUnique({ where: { codeHash } });
      if (!row) {
        return undefined;
      }
      const { codeHash: hash, clientId, redirectUri, codeChallenge, resource, scope, expiresAt } = row;
      return { code: { codeHash: hash, fleetId: idSchema('fleet').parse(row.fleetId), clientId, redirectUri, codeChallenge, resource, scope, expiresAt, ...holderOfRow(row) }, wasUsed: marked.count === 0 };
    },
  };
}

interface PairRow {
  familyId: string;
  codeHash: string | null;
  fleetId: string;
  clientId: string;
  resource: string;
  scope: string | null;
  party: string | null;
  grantId: string | null;
  accessHash: string;
  accessExpiresAt: Date;
  refreshHash: string | null;
  refreshExpiresAt: Date | null;
  state: string;
}

function pairOf(row: PairRow): TokenPair & { state: TokenState } {
  const { familyId, codeHash, clientId, resource, scope, accessHash, accessExpiresAt, refreshHash, refreshExpiresAt } = row;
  return { familyId, codeHash, fleetId: idSchema('fleet').parse(row.fleetId), clientId, resource, scope, accessHash, accessExpiresAt, refreshHash, refreshExpiresAt, ...holderOfRow(row), state: tokenStateSchema.parse(row.state) };
}

export function createPrismaIssuedTokens(db: Db): IssuedTokens {
  return {
    save: async (pair) => {
      const { familyId, codeHash, fleetId, clientId, resource, scope, accessHash, accessExpiresAt, refreshHash, refreshExpiresAt } = pair;
      await db.issuedToken.create({ data: { familyId, codeHash, fleetId, clientId, resource, scope, accessHash, accessExpiresAt, refreshHash, refreshExpiresAt, ...holderColumns(pair), state: 'active' } });
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
    revokeGrant: async (fleetId, grantId) => {
      await db.issuedToken.updateMany({ where: { fleetId, grantId }, data: { state: 'revoked' } });
    },
    revokeParty: async (fleetId, party) => {
      await db.issuedToken.updateMany({ where: { fleetId, party }, data: { state: 'revoked' } });
    },
  };
}
