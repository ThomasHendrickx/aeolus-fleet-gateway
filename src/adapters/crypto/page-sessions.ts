import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { PageSessions } from '../../core/sign-in/ports.js';
import { createSealer } from './sealer.js';

/** The cookie a browser signed in to the gateway's pages holds; not the console's aeolus_session, which the fleet reads. */
export const PAGE_SESSION_COOKIE = 'aeolus_gateway_session';

/** Its own label, so the sealing key is never also a key the gateway derives elsewhere. */
const SEAL_LABEL = 'page-session';

const sealedSchema = z.object({ fleetId: idSchema('fleet'), grantId: z.string().min(1) });

/**
 * Seals a page session into the gateway's own cookie under a key derived
 * from the gateway's secret, and finds it in a Cookie header. A value
 * changed on the way, or sealed under another secret or label, is none.
 */
export function createPageSessions(secret: string): PageSessions {
  const sealer = createSealer(secret, SEAL_LABEL);
  const prefix = `${PAGE_SESSION_COOKIE}=`;
  return {
    seal: ({ fleetId, grantId }) => sealer.seal({ fleetId, grantId }),
    inCookie: (cookie) => {
      const sealed = cookie
        .split(';')
        .map((pair) => pair.trim())
        .find((pair) => pair.startsWith(prefix))
        ?.slice(prefix.length);
      if (sealed === undefined || sealed === '') {
        return undefined;
      }
      const session = sealedSchema.safeParse(sealer.open(sealed));
      return session.success ? session.data : undefined;
    },
  };
}
