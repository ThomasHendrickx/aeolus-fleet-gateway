import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { Party } from '../../core/parties/party.js';
import type { PartyStore } from '../../core/parties/ports.js';
import type { McpServerCredential } from '../../core/vault/credential.js';
import type { Db } from './client.js';
import { Prisma } from './generated/client.js';

/** A credential as the vault keeps it, read back. */
const credentialSchema: z.ZodType<McpServerCredential> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('bearer'), token: z.string() }),
  z.object({ kind: z.literal('clientCredentials'), clientId: z.string(), clientSecret: z.string(), issuer: z.string(), scope: z.string().optional() }),
]);

interface Row {
  fleetId: string;
  name: string;
  kind: string;
  url: string | null;
  credential: unknown;
  concurrencyLimit: number | null;
  clientId: string | null;
  ownerShipId: string;
  state: string;
  proxyShipId: string | null;
  secret: string | null;
  crewToken: string | null;
  requestId: string;
  requestHash: string;
  approvedAt: Date;
}

const kindSchema = z.enum(['mcpServer', 'mcpClient']);

function partyOf(row: Row): Party {
  const base = {
    fleetId: idSchema('fleet').parse(row.fleetId),
    name: row.name,
    ownerShipId: idSchema('ship').parse(row.ownerShipId),
    state: z.enum(['commissioning', 'awaitingCrew', 'crewed']).parse(row.state),
    proxyShipId: row.proxyShipId === null ? null : idSchema('ship').parse(row.proxyShipId),
    secret: row.secret,
    crewToken: row.crewToken,
    requestId: row.requestId,
    requestHash: row.requestHash,
    approvedAt: row.approvedAt,
  };
  const kind = kindSchema.parse(row.kind);
  switch (kind) {
    case 'mcpServer':
      return { ...base, kind, url: z.string().parse(row.url), credential: credentialSchema.parse(row.credential), concurrencyLimit: z.int().parse(row.concurrencyLimit) };
    case 'mcpClient':
      return { ...base, kind, clientId: z.string().parse(row.clientId) };
  }
}

/** The columns only one kind of party fills; the other kind leaves them empty. */
function outsideColumnsOf(party: Party) {
  switch (party.kind) {
    case 'mcpServer':
      return { url: party.url, credential: { ...party.credential }, concurrencyLimit: party.concurrencyLimit, clientId: null };
    case 'mcpClient':
      return { url: null, credential: Prisma.DbNull, concurrencyLimit: null, clientId: party.clientId };
  }
}

/** The parties, one row per fleet and name, each with its vault; and every crewed one, whose calls the gateway takes from its start. */
export function createPrismaPartyStore(db: Db): PartyStore & { crewed(): Promise<Party[]> } {
  return {
    crewed: async () => (await db.party.findMany({ where: { state: 'crewed' }, orderBy: [{ fleetId: 'asc' }, { name: 'asc' }] })).map(partyOf),
    find: async (fleetId, name) => {
      const row = await db.party.findUnique({ where: { fleetId_name: { fleetId, name } } });
      return row ? partyOf(row) : undefined;
    },
    list: async (fleetId) => (await db.party.findMany({ where: { fleetId }, orderBy: { name: 'asc' } })).map(partyOf),
    save: async (party) => {
      const columns = {
        kind: party.kind,
        ...outsideColumnsOf(party),
        ownerShipId: party.ownerShipId,
        state: party.state,
        proxyShipId: party.proxyShipId,
        secret: party.secret,
        crewToken: party.crewToken,
        requestId: party.requestId,
        requestHash: party.requestHash,
        approvedAt: party.approvedAt,
      };
      await db.party.upsert({ where: { fleetId_name: { fleetId: party.fleetId, name: party.name } }, create: { fleetId: party.fleetId, name: party.name, ...columns }, update: columns });
    },
    remove: async (fleetId, name) => {
      await db.party.deleteMany({ where: { fleetId, name } });
    },
  };
}
