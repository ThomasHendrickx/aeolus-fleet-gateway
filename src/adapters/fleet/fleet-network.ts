/**
 * Reads whether the fleet applies network rules with `fleet.networkRules`
 * (aeolus-fleet #997), as the actor who asked (decision 0057): a ship with its
 * crew token over REST, an account with its account token presented by the
 * gateway's ship over REST, argo with the console session over tRPC.
 */
import { networkRulesOutputSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { FleetRefusal } from '../../core/connection/ports.js';
import type { ActorCredential } from '../../core/actors/credential-of.js';
import type { FleetNetwork } from '../../core/outside-parties/ports.js';
import { err, ok, type Result } from '../../core/shared/result.js';
import { refusalOf, restHeaders } from './actor-door.js';

const trpcAnswerSchema = z.object({ result: z.object({ data: networkRulesOutputSchema }) }).transform(({ result }) => result.data);

export function createFleetNetwork(fleetUrl: string): FleetNetwork {
  return {
    isOpen: async (as: ActorCredential): Promise<Result<boolean, FleetRefusal>> => {
      const request =
        as.crewToken === undefined
          ? { url: `${fleetUrl}/trpc/fleet.networkRules`, headers: { cookie: as.cookie ?? '' } }
          : { url: `${fleetUrl}/api/v1/fleet/networkRules`, headers: restHeaders(as) };
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
      const rules = (as.crewToken === undefined ? trpcAnswerSchema : networkRulesOutputSchema).safeParse(body);
      return rules.success ? ok(rules.data.applied.rules === null) : err({ code: 'UNAVAILABLE', message: 'The fleet answered no network rules' });
    },
  };
}
