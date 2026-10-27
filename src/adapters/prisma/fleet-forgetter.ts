import type { FleetForgetter } from '../../core/installation/ports.js';
import type { PrismaClient } from './client.js';

/** Forgets every record the gateway holds of a fleet, in one transaction: its connection, its switch, its outside parties switch, its parties with their vault, argo's marks, its calls, its outside clients' calls with their replies and A2A tasks with their push configs and pushes, its messages to outside A2A agents with their replies, its OAuth clients, codes and tokens, its signed-in accounts' grants and their person ships' crews, the email channels they turned on, the wakes sent, their pages in focus and the browsers they turned web push on in, and the requests that name it with their outcomes still to tell and the questions to the gateway's owner about them, and its Slack workspace with the apps made in it. */
export function createPrismaFleetForgetter(db: PrismaClient): FleetForgetter {
  return {
    forget: async (fleetId) => {
      const where = { where: { fleetId } };
      await db.$transaction([db.connection.deleteMany(where), db.fleetSwitch.deleteMany(where), db.outsidePartySwitch.deleteMany(where), db.party.deleteMany(where), db.toolMark.deleteMany(where), db.call.deleteMany(where), db.clientCall.deleteMany(where), db.clientCallReply.deleteMany(where), db.a2aPush.deleteMany(where), db.a2aPushConfig.deleteMany(where), db.a2aTask.deleteMany(where), db.a2aAgentCall.deleteMany(where), db.a2aAgentReply.deleteMany(where), db.oAuthClient.deleteMany(where), db.authorizationCode.deleteMany(where), db.issuedToken.deleteMany(where), db.accountGrant.deleteMany(where), db.personCrew.deleteMany(where), db.emailChannel.deleteMany(where), db.wakeSent.deleteMany(where), db.focusedPage.deleteMany(where), db.webPushSubscription.deleteMany(where), db.openedDelivery.deleteMany(where), db.pendingRequest.deleteMany(where), db.requestOutcomeNotice.deleteMany(where), db.ownerQuestion.deleteMany(where), db.installationRequest.deleteMany(where), db.slackApp.deleteMany(where), db.slackLink.deleteMany(where), db.slackWorkspace.deleteMany(where)]);
    },
  };
}
