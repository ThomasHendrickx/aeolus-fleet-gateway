import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { PageSessions } from '../../core/sign-in/ports.js';
import { createSealer } from './sealer.js';

/** The cookie a browser signed in to the gateway's pages holds; not the console's aeolus_session, which the fleet reads. */
export const PAGE_SESSION_COOKIE = 'aeolus_gateway_session';

const PREFIX = `${PAGE_SESSION_COOKIE}=`;

/**
 * The page session's own pair in a Cookie header, and nothing else: the
 * pages are accounts only (Thomas, 20 Oct), so no other cookie the browser
 * sends, such as the console's, reaches them.
 */
export function pageCookieOf(header: string | undefined): string | undefined {
  return header
    ?.split(';')
    .map((pair) => pair.trim())
    .find((pair) => pair.startsWith(PREFIX) && pair.length > PREFIX.length);
}

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
  return {
    seal: ({ fleetId, grantId }) => sealer.seal({ fleetId, grantId }),
    inCookie: (cookie) => {
      const sealed = pageCookieOf(cookie)?.slice(PREFIX.length);
      if (sealed === undefined) {
        return undefined;
      }
      const session = sealedSchema.safeParse(sealer.open(sealed));
      return session.success ? session.data : undefined;
    },
  };
}
