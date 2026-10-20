/**
 * The fleet's two doors for a call made as the actor (decision 0057): a crew
 * token, alone or presenting an account's token, over REST; argo's or a
 * viewer's console session over tRPC, as the console calls it. Each answers
 * the fleet's refusal as its code and message.
 */
import { z } from 'zod';

import type { ActorCredential } from '../../core/actors/credential-of.js';
import type { FleetRefusal } from '../../core/connection/ports.js';
import { err, ok, type Result } from '../../core/shared/result.js';

/** The header an account's token travels in; common's ACCOUNT_TOKEN_HEADER replaces it once published (aeolus-fleet#991). */
export const ACCOUNT_TOKEN_HEADER = 'aeolus-account-token';

const refusalSchema = z.object({ code: z.string(), message: z.string() });
const trpcRefusalSchema = z.object({ error: z.object({ message: z.string(), data: z.object({ code: z.string() }) }) });
const trpcAnswerSchema = z.object({ result: z.object({ data: z.unknown() }) });

/** The fleet's refusal as its code and message, whichever door answered it. */
export function refusalOf(status: number, body: unknown): FleetRefusal {
  const rest = refusalSchema.safeParse(body);
  if (rest.success) {
    return rest.data;
  }
  const trpc = trpcRefusalSchema.safeParse(body);
  return trpc.success ? { code: trpc.data.error.data.code, message: trpc.data.error.message } : { code: 'UNAVAILABLE', message: `The fleet answered ${String(status)}` };
}

/** The headers a REST call carries as the actor: its crew token, and the account's token it presents. */
export function restHeaders(as: ActorCredential): Record<string, string> {
  return { authorization: `Bearer ${as.crewToken ?? ''}`, ...(as.accountToken === undefined ? {} : { [ACCOUNT_TOKEN_HEADER]: as.accountToken }) };
}

/** One fleet mutation as the actor, by the door its credential goes through: what the fleet answered, unparsed. */
export async function mutateAs(fleetUrl: string, call: { as: ActorCredential; procedure: string; input: unknown; isTrpcOnly?: boolean }): Promise<Result<unknown, FleetRefusal>> {
  const { as, procedure, input } = call;
  const isConsole = as.crewToken === undefined;
  // A call with no REST door goes over tRPC with the same headers a REST call carries.
  const isTrpc = isConsole || call.isTrpcOnly === true;
  const request = isConsole
    ? { url: `${fleetUrl}/trpc/fleet.${procedure}`, headers: { cookie: as.cookie ?? '' } }
    : { url: isTrpc ? `${fleetUrl}/trpc/fleet.${procedure}` : `${fleetUrl}/api/v1/fleet/${procedure}`, headers: restHeaders(as) };
  let response: Response;
  try {
    response = await fetch(request.url, { method: 'POST', headers: { 'content-type': 'application/json', ...request.headers }, body: JSON.stringify(input) });
  } catch (error) {
    return err({ code: 'UNAVAILABLE', message: error instanceof Error ? error.message : 'The fleet did not answer' });
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    return err(refusalOf(response.status, body));
  }
  if (!isTrpc) {
    return ok(body);
  }
  const answer = trpcAnswerSchema.safeParse(body);
  return answer.success ? ok(answer.data.result.data) : err({ code: 'UNAVAILABLE', message: 'The fleet answered no result' });
}
