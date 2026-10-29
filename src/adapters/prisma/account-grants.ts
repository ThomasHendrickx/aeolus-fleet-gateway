import { idSchema } from '@aeolus-fleet/common';

import type { AccountGrant, AccountGrants } from '../../core/sign-in/ports.js';
import type { Db } from './client.js';

function grantOf(row: { grantId: string; fleetId: string; accountId: string; personShipId: string | null; scopes: string[]; refreshToken: string; accountToken: string; accountTokenExpiresAt: Date }): AccountGrant {
  return { ...row, fleetId: idSchema('fleet').parse(row.fleetId), personShipId: row.personShipId === null ? null : idSchema('ship').parse(row.personShipId) };
}

/** Signed-in accounts' grants, each in its fleet (decision 0054). */
export function createPrismaAccountGrants(db: Db): AccountGrants {
  return {
    save: async (grant) => {
      await db.accountGrant.create({ data: { ...grant, scopes: [...grant.scopes] } });
    },
    find: async (fleetId, grantId) => {
      const row = await db.accountGrant.findFirst({ where: { fleetId, grantId } });
      return row ? grantOf(row) : undefined;
    },
    ofAccount: async (fleetId, accountId) => {
      const rows = await db.accountGrant.findMany({ where: { fleetId, accountId } });
      return rows.map(grantOf);
    },
    renew: async ({ fleetId, grantId }, tokens) => {
      await db.accountGrant.updateMany({ where: { fleetId, grantId }, data: { ...tokens, scopes: tokens.scopes === undefined ? undefined : [...tokens.scopes] } });
    },
    end: async (fleetId, grantId) => {
      await db.accountGrant.deleteMany({ where: { fleetId, grantId } });
    },
  };
}
