import { idSchema } from '@aeolus-fleet/common';

import type { PartyGrant } from '../../core/party-grants/party-grant.js';
import type { PartyGrants } from '../../core/party-grants/ports.js';
import type { PrismaClient } from './client.js';
import { Prisma, type PartyGrant as PartyGrantRow } from './generated/client.js';

/** Prisma's code for a row a unique key already holds. */
const UNIQUE_VIOLATION = 'P2002';

function grantOf(row: PartyGrantRow): PartyGrant {
  return {
    fleetId: idSchema('fleet').parse(row.fleetId),
    party: row.party,
    personShipId: idSchema('ship').parse(row.personShipId),
    accountId: row.accountId,
    outsideAccount: { subject: row.subject, name: row.outsideAccountName },
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    accessTokenEndsAt: row.accessTokenEndsAt,
    signedInAt: row.signedInAt,
    lastUsedAt: row.lastUsedAt,
  };
}

/**
 * Each party's grants, one row per person and party: a new sign-in
 * overwrites the person's row in one statement, and the database keeps one
 * of two persons' grants naming the same outside account, by its unique key
 * on the subject (Q13).
 */
export function createPrismaPartyGrants(db: PrismaClient): PartyGrants {
  return {
    ofPerson: async (fleetId, { party, personShipId }) => {
      const row = await db.partyGrant.findUnique({ where: { fleetId_party_personShipId: { fleetId, party, personShipId } } });
      return row === null ? undefined : grantOf(row);
    },
    ofSubject: async (fleetId, { party, subject }) => {
      const row = await db.partyGrant.findUnique({ where: { fleetId_party_subject: { fleetId, party, subject } } });
      return row === null ? undefined : grantOf(row);
    },
    usable: async (fleetId, { party, now }) => {
      const row = await db.partyGrant.findFirst({
        where: { fleetId, party, OR: [{ accessTokenEndsAt: null }, { accessTokenEndsAt: { gt: now } }] },
        orderBy: [{ lastUsedAt: { sort: 'desc', nulls: 'last' } }, { signedInAt: 'desc' }],
      });
      return row === null ? undefined : grantOf(row);
    },
    keep: async (grant) => {
      const { fleetId, party, personShipId, outsideAccount, ...tokens } = grant;
      const fields = { ...tokens, subject: outsideAccount.subject, outsideAccountName: outsideAccount.name };
      try {
        await db.partyGrant.upsert({ where: { fleetId_party_personShipId: { fleetId, party, personShipId } }, create: { fleetId, party, personShipId, ...fields }, update: fields });
      } catch (error) {
        // The key on the person is the upsert's own, so only the subject's is left to be held: another person's grant names the account.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
          return 'subjectTaken';
        }
        throw error;
      }
      return 'kept';
    },
    remove: async (fleetId, { party, personShipId }) => {
      await db.partyGrant.deleteMany({ where: { fleetId, party, personShipId } });
    },
  };
}
