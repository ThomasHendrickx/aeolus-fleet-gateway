import type { FleetForgetter } from '../../core/installation/ports.js';
import type { PrismaClient } from './client.js';

/** Forgets every record the gateway holds of a fleet, in one transaction: its connection, its switch, its outside parties switch, its parties with their vault, argo's marks, its calls, its outside clients' calls with their replies, its OAuth clients, codes and tokens, its signed-in accounts' grants and their person ships' crews, the email channels they turned on and the wakes sent, and the requests that name it with their outcomes still to tell and the questions to the gateway's owner about them. */
export function createPrismaFleetForgetter(db: PrismaClient): FleetForgetter {
  return {
    forget: async (fleetId) => {
      const where = { where: { fleetId } };
      await db.$transaction([db.connection.deleteMany(where), db.fleetSwitch.deleteMany(where), db.outsidePartySwitch.deleteMany(where), db.party.deleteMany(where), db.toolMark.deleteMany(where), db.call.deleteMany(where), db.clientCall.deleteMany(where), db.clientCallReply.deleteMany(where), db.oAuthClient.deleteMany(where), db.authorizationCode.deleteMany(where), db.issuedToken.deleteMany(where), db.accountGrant.deleteMany(where), db.personCrew.deleteMany(where), db.emailChannel.deleteMany(where), db.wakeSent.deleteMany(where), db.openedDelivery.deleteMany(where), db.pendingRequest.deleteMany(where), db.requestOutcomeNotice.deleteMany(where), db.ownerQuestion.deleteMany(where), db.installationRequest.deleteMany(where)]);
    },
  };
}
