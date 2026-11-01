import { idSchema } from '@aeolus-fleet/common';

import type { ArgoAccounts } from '../../core/argo-inbox/ports.js';
import type { Db } from './client.js';

/** The accounts allowed as argo, a row each by fleet and account. */
export function createPrismaArgoAccounts(db: Db): ArgoAccounts {
  return {
    keep: async (fleetId, { accountId, personShipId }) => {
      await db.argoAccount.upsert({ where: { fleetId_accountId: { fleetId, accountId } }, create: { fleetId, accountId, personShipId }, update: { personShipId } });
    },
    drop: async (fleetId, accountId) => {
      await db.argoAccount.deleteMany({ where: { fleetId, accountId } });
    },
    list: async (fleetId) => {
      const rows = await db.argoAccount.findMany({ where: { fleetId }, orderBy: { accountId: 'asc' } });
      return rows.map(({ accountId, personShipId }) => ({ accountId, personShipId: idSchema('ship').parse(personShipId) }));
    },
  };
}
