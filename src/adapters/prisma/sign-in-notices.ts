import type { SignInNotices } from '../../core/party-grants/ports.js';
import type { PrismaClient } from './client.js';

/**
 * The notices of a missing sign-in, one row per person and party while
 * open: opening one inserts it unless a row is there, so two calls at once
 * keep the first id, and a sign-in deletes it.
 */
export function createPrismaSignInNotices(db: PrismaClient): SignInNotices {
  return {
    open: async (fleetId, { party, personShipId, noticeId }) => {
      // ON CONFLICT DO NOTHING: of two calls opening it at once, both read the one row the first inserted.
      await db.partySignInNotice.createMany({ data: [{ fleetId, party, personShipId, noticeId }], skipDuplicates: true });
      const row = await db.partySignInNotice.findUniqueOrThrow({ where: { fleetId_party_personShipId: { fleetId, party, personShipId } } });
      return { noticeId: row.noticeId, isTold: row.isTold };
    },
    markTold: async (fleetId, { party, personShipId }) => {
      await db.partySignInNotice.updateMany({ where: { fleetId, party, personShipId }, data: { isTold: true } });
    },
    close: async (fleetId, { party, personShipId }) => {
      await db.partySignInNotice.deleteMany({ where: { fleetId, party, personShipId } });
    },
  };
}
