import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { SignIns } from '../../core/federation/ports.js';
import type { Db } from './client.js';

/** A row as DELETE ... RETURNING answers it: Postgres's own column names. */
const takenSchema = z.array(
  z.object({ fleet_id: idSchema('fleet'), request: z.record(z.string(), z.string()), verifier: z.string(), nonce: z.string(), expires_at: z.date() }),
);

/** The sign-ins under way, a row each: taking one deletes it in one statement, so of two takes only one finds it. */
export function createPrismaSignIns(db: Db): SignIns {
  return {
    save: async ({ stateHash, fleetId, request, verifier, nonce, expiresAt }) => {
      await db.signIn.create({ data: { stateHash, fleetId, request: { ...request }, verifier, nonce, expiresAt } });
    },
    take: async (stateHash) => {
      const rows: unknown = await db.$queryRaw`DELETE FROM sign_ins WHERE state_hash = ${stateHash} RETURNING fleet_id, request, verifier, nonce, expires_at`;
      const [row] = takenSchema.parse(rows);
      return row ? { stateHash, fleetId: row.fleet_id, request: row.request, verifier: row.verifier, nonce: row.nonce, expiresAt: row.expires_at } : undefined;
    },
  };
}
