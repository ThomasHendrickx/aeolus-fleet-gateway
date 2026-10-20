/**
 * Reads whether the fleet applies network rules with `fleet.networkRules`
 * (aeolus-fleet #997), as the actor who asked (decision 0057): a ship with its
 * crew token over REST, an account with its account token presented by the
 * gateway's ship over REST, argo with the console session over tRPC. The answer's
 * schema stands in for common's until core 0.28 publishes it (aeolus-fleet#991).
 */
import { z } from 'zod';

import type { FleetRefusal } from '../../core/connection/ports.js';
import type { ActorCredential } from '../../core/actors/credential-of.js';
import type { FleetNetwork } from '../../core/outside-parties/ports.js';
import { err, ok, type Result } from '../../core/shared/result.js';

/** The header an account's token travels in; common's ACCOUNT_TOKEN_HEADER replaces it once published (aeolus-fleet#991). */
const ACCOUNT_TOKEN_HEADER = 'aeolus-account-token';

const networkRulesSchema = z.object({ applied: z.object({ rules: z.array(z.unknown()).nullable() }) });
const trpcAnswerSchema = z.object({ result: z.object({ data: networkRulesSchema }) }).transform(({ result }) => result.data);
const refusalSchema = z.object({ code: z.string(), message: z.string() });
const trpcRefusalSchema = z.object({ error: z.object({ message: z.string(), data: z.object({ code: z.string() }) }) });

/** The fleet's refusal as its code and message, whichever door answered it. */
function refusalOf(status: number, body: unknown): FleetRefusal {
  const rest = refusalSchema.safeParse(body);
  if (rest.success) {
    return rest.data;
  }
  const trpc = trpcRefusalSchema.safeParse(body);
  return trpc.success ? { code: trpc.data.error.data.code, message: trpc.data.error.message } : { code: 'UNAVAILABLE', message: `The fleet answered ${String(status)}` };
}

export function createFleetNetwork(fleetUrl: string): FleetNetwork {
  return {
    isOpen: async (as: ActorCredential): Promise<Result<boolean, FleetRefusal>> => {
      const request =
        as.crewToken === undefined
          ? { url: `${fleetUrl}/trpc/fleet.networkRules`, headers: { cookie: as.cookie ?? '' } }
          : { url: `${fleetUrl}/api/v1/fleet/networkRules`, headers: { authorization: `Bearer ${as.crewToken}`, ...(as.accountToken === undefined ? {} : { [ACCOUNT_TOKEN_HEADER]: as.accountToken }) } };
      let response: Response;
      try {
        response = await fetch(request.url, { headers: request.headers });
      } catch (error) {
        return err({ code: 'UNAVAILABLE', message: error instanceof Error ? error.message : 'The fleet did not answer' });
      }
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        return err(refusalOf(response.status, body));
      }
      const rules = (as.crewToken === undefined ? trpcAnswerSchema : networkRulesSchema).safeParse(body);
      return rules.success ? ok(rules.data.applied.rules === null) : err({ code: 'UNAVAILABLE', message: 'The fleet answered no network rules' });
    },
  };
}
