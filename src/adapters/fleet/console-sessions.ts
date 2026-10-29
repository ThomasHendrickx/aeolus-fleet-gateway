/**
 * Asks the fleet whose a forwarded console session cookie is, the
 * operator's, a viewer's or an account's, with its scopes, with
 * `console.session` (decisions 0012, 0022, 0043 and 0053): the cookie travels
 * from the console's server, server to server.
 */
import { consoleSessionOutputSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { ConsoleSessions } from '../../core/operator/ports.js';
import { err, ok } from '../../core/shared/result.js';

const sessionAnswer = z.object({ result: z.object({ data: consoleSessionOutputSchema }) });

export function createFleetConsoleSessions(fleetUrl: string): ConsoleSessions {
  return {
    check: async (cookie) => {
      const response = await fetch(`${fleetUrl}/trpc/console.session`, { headers: { cookie } });
      if (!response.ok) {
        return err({ code: 'UNAUTHORIZED', message: 'No signed-in console session' });
      }
      const { fleetId, kind, accountId, scopes } = sessionAnswer.parse(await response.json()).result.data;
      if (kind !== 'account') {
        return ok({ fleetId, kind, scopes });
      }
      // An account's session names its account; one that does not is no session the gateway serves.
      return accountId === undefined ? err({ code: 'UNAUTHORIZED', message: 'An account session without its account' }) : ok({ fleetId, kind, accountId, scopes });
    },
  };
}
