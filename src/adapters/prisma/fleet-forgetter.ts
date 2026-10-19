import type { FleetForgetter } from '../../core/installation/ports.js';
import type { PrismaClient } from './client.js';

/** Forgets every record the gateway holds of a fleet, in one transaction: its connection, its switch, its parties with their vault, argo's marks, its calls, its outside clients' calls with their replies, its OAuth clients, codes and tokens, its identity provider, and the requests that name it. */
export function createPrismaFleetForgetter(db: PrismaClient): FleetForgetter {
  return {
    forget: async (fleetId) => {
      const where = { where: { fleetId } };
      await db.$transaction([db.connection.deleteMany(where), db.fleetSwitch.deleteMany(where), db.party.deleteMany(where), db.toolMark.deleteMany(where), db.call.deleteMany(where), db.clientCall.deleteMany(where), db.clientCallReply.deleteMany(where), db.oAuthClient.deleteMany(where), db.authorizationCode.deleteMany(where), db.issuedToken.deleteMany(where), db.identityProvider.deleteMany(where), db.installationRequest.deleteMany(where)]);
    },
  };
}
