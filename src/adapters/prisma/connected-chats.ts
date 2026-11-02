/** The chats connected through the gateway as a person ship: its account grants' token pairs still active, with their clients' names (Bridge, section 8). */
import type { ConnectedChats } from '../../core/people/ports.js';
import type { Db } from './client.js';

export function createPrismaConnectedChats(db: Db): ConnectedChats {
  return {
    list: async (fleetId, shipId) => {
      const grants = await db.accountGrant.findMany({ where: { fleetId, personShipId: shipId }, select: { grantId: true } });
      if (grants.length === 0) {
        return [];
      }
      const pairs = await db.issuedToken.findMany({
        where: { fleetId, state: 'active', grantId: { in: grants.map(({ grantId }) => grantId) } },
        select: { clientId: true, accessExpiresAt: true, refreshExpiresAt: true },
      });
      const clients = await db.oAuthClient.findMany({ where: { clientId: { in: [...new Set(pairs.map(({ clientId }) => clientId))] } }, select: { clientId: true, name: true } });
      const names = new Map(clients.map(({ clientId, name }) => [clientId, name]));
      return pairs.flatMap(({ clientId, accessExpiresAt, refreshExpiresAt }) => {
        const name = names.get(clientId);
        return name === undefined ? [] : [{ name, liveUntil: refreshExpiresAt ?? accessExpiresAt }];
      });
    },
  };
}
