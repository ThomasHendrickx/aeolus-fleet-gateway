import { idSchema } from '@aeolus-fleet/common';

import { IDLE_REFRESH_MS, REFRESH_AHEAD_MS, type PartyGrant } from '../../core/party-grants/party-grant.js';
import type { PartyGrants } from '../../core/party-grants/ports.js';
import type { PrismaClient } from './client.js';
import { Prisma, type PartyGrant as PartyGrantRow } from './generated/client.js';

/** Prisma's code for a row a unique key already holds. */
const UNIQUE_VIOLATION = 'P2002';

/** The most grants one round of the schedule refreshes; the rest wait for the next round. */
const DUE_PER_ROUND = 100;

/** How long a change holding a grant may take: a refresh waits on the authorization server, at most its answer wait. */
const CHANGE_TIMEOUT_MS = 30_000;

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
    refreshedAt: row.refreshedAt,
    lastUsedAt: row.lastUsedAt,
    lost: row.lostAt === null || row.lostWhy === null ? null : { at: row.lostAt, why: row.lostWhy },
  };
}

/** The grant's fields a row keeps beside its key. */
function rowOf(grant: PartyGrant) {
  const { accountId, outsideAccount, accessToken, refreshToken, accessTokenEndsAt, signedInAt, refreshedAt, lastUsedAt, lost } = grant;
  return { accountId, subject: outsideAccount.subject, outsideAccountName: outsideAccount.name, accessToken, refreshToken, accessTokenEndsAt, signedInAt, refreshedAt, lastUsedAt, lostAt: lost?.at ?? null, lostWhy: lost?.why ?? null };
}

/**
 * Each party's grants, one row per person and party: a new sign-in
 * overwrites the person's row in one statement, and the database keeps one
 * of two persons' grants naming the same outside account, by its unique key
 * on the subject (Q13). A change holds the grant's row (FOR UPDATE) until it
 * is kept, so two gateway instances refresh a grant one at a time.
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
        where: { fleetId, party, lostAt: null, OR: [{ accessTokenEndsAt: null }, { accessTokenEndsAt: { gt: now } }] },
        orderBy: [{ lastUsedAt: { sort: 'desc', nulls: 'last' } }, { signedInAt: 'desc' }],
      });
      return row === null ? undefined : grantOf(row);
    },
    keep: async (grant) => {
      const { fleetId, party, personShipId } = grant;
      const fields = rowOf(grant);
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
    change: ({ fleetId, party, personShipId }, change) =>
      db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM "party_grants" WHERE "fleet_id" = ${fleetId} AND "party" = ${party} AND "person_ship_id" = ${personShipId} FOR UPDATE`;
          const row = await tx.partyGrant.findUnique({ where: { fleetId_party_personShipId: { fleetId, party, personShipId } } });
          if (row === null) {
            return undefined;
          }
          const changed = await change(grantOf(row));
          await tx.partyGrant.update({ where: { fleetId_party_personShipId: { fleetId, party, personShipId } }, data: rowOf(changed) });
          return changed;
        },
        { timeout: CHANGE_TIMEOUT_MS },
      ),
    due: async ({ now }) => {
      const idleSince = new Date(now.getTime() - IDLE_REFRESH_MS);
      const rows = await db.partyGrant.findMany({
        where: {
          lostAt: null,
          refreshToken: { not: null },
          OR: [{ accessTokenEndsAt: { lte: new Date(now.getTime() + REFRESH_AHEAD_MS) } }, { refreshedAt: { lt: idleSince } }, { refreshedAt: null, signedInAt: { lt: idleSince } }],
        },
        orderBy: { accessTokenEndsAt: { sort: 'asc', nulls: 'last' } },
        take: DUE_PER_ROUND,
      });
      return rows.map(grantOf);
    },
    markUsed: async ({ fleetId, party, personShipId }, at) => {
      await db.partyGrant.updateMany({ where: { fleetId, party, personShipId }, data: { lastUsedAt: at } });
    },
    remove: async (fleetId, { party, personShipId }) => {
      await db.partyGrant.deleteMany({ where: { fleetId, party, personShipId } });
    },
  };
}
