import { idSchema } from '@aeolus-fleet/common';

import type { SignInNotice, SignInNotices } from '../../core/party-grants/ports.js';
import type { PrismaClient } from './client.js';

type SignInNoticeRow = NonNullable<Awaited<ReturnType<PrismaClient['partySignInNotice']['findUnique']>>>;

function noticeOf(row: SignInNoticeRow): SignInNotice {
  return { noticeId: row.noticeId, isTold: row.isTold, stepMessageId: row.stepMessageId === null ? null : idSchema('message').parse(row.stepMessageId) };
}

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
      return noticeOf(await db.partySignInNotice.findUniqueOrThrow({ where: { fleetId_party_personShipId: { fleetId, party, personShipId } } }));
    },
    markTold: async (fleetId, { party, personShipId, stepMessageId }) => {
      await db.partySignInNotice.updateMany({ where: { fleetId, party, personShipId }, data: { isTold: true, stepMessageId } });
    },
    close: async (fleetId, { party, personShipId }) => {
      const found = await db.partySignInNotice.findUnique({ where: { fleetId_party_personShipId: { fleetId, party, personShipId } } });
      // Of two sign-ins closing it at once, only the one whose delete took the row answers it.
      const { count } = await db.partySignInNotice.deleteMany({ where: { fleetId, party, personShipId } });
      return found === null || count === 0 ? undefined : noticeOf(found);
    },
  };
}
