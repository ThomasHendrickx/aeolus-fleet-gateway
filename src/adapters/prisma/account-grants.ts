import type { AccountGrants } from '../../core/sign-in/ports.js';
import type { Db } from './client.js';

/** Signed-in accounts' grants, each in its fleet (decision 0054). */
export function createPrismaAccountGrants(db: Db): AccountGrants {
  return {
    save: async (grant) => {
      await db.accountGrant.create({ data: { ...grant } });
    },
  };
}
