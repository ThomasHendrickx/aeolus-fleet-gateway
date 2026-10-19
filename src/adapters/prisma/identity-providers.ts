import type { IdentityProviders } from '../../core/federation/ports.js';
import type { Db } from './client.js';

/** The fleets' identity providers, a row per fleet: setting one again replaces it. */
export function createPrismaIdentityProviders(db: Db): IdentityProviders {
  return {
    find: async (fleetId) => {
      const row = await db.identityProvider.findUnique({ where: { fleetId } });
      return row ? { fleetId, issuer: row.issuer, clientId: row.clientId, clientSecret: row.clientSecret, setAt: row.setAt } : undefined;
    },
    save: async ({ fleetId, issuer, clientId, clientSecret, setAt }) => {
      const fields = { issuer, clientId, clientSecret, setAt };
      await db.identityProvider.upsert({ where: { fleetId }, create: { fleetId, ...fields }, update: fields });
    },
  };
}
