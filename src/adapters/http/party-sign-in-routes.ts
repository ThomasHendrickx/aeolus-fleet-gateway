/**
 * The door a party's authorization server sends a person back to after
 * they signed in to it for themselves (decision 0067):
 * `/outside-parties/sign-in/done`, the redirect URI every party's client was
 * registered with. It carries the browser's shared sign-in, so the sign-in
 * binds to the account that started it. The person goes on to the party's
 * page, which says how the sign-in went by its outcome in the address, and
 * the authorization server's error code where it answered one, never a text
 * the address carries.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { SHARED_SIGN_IN_COOKIE } from '../../core/account-sign-in/ports.js';
import type { CompletePartySignIn, CompletePartySignInRefusal } from '../../core/party-grants/complete-party-sign-in.js';
import { cookieValueOf } from './account-sign-in-routes.js';

export const PARTY_SIGN_IN_DONE_PATH = '/outside-parties/sign-in/done';

/** The outside parties' pages of the web app (web/features/outside-parties/paths.ts names the same). */
const OUTSIDE_PARTIES_PATH = '/outside-parties';

const HTTP_FOUND = 302;

/** An OAuth error code as RFC 6749 spells one: anything else the address does not carry. */
const ERROR_CODE = /^[\w.-]{1,64}$/;

const backSchema = z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional(), iss: z.string().optional() });

/** What the party's page says of a sign-in, by its outcome. */
const OUTCOMES = {
  SIGN_IN_FAILED: 'failed',
  NO_SUCH_PARTY: 'failed',
  NOT_SIGNED_IN: 'not-signed-in',
  TURNED_AWAY: 'turned-away',
  AUTHORIZATION_SERVER_UNREACHABLE: 'unavailable',
} as const satisfies Record<CompletePartySignInRefusal['kind'], string>;

/** The part of a logger this needs: a warning with its fields. */
interface WarningLog {
  warn(fields: Record<string, unknown>, message: string): void;
}

export function registerPartySignInRoutes(server: FastifyInstance, deps: { complete: CompletePartySignIn; log: WarningLog }): void {
  server.get(PARTY_SIGN_IN_DONE_PATH, async (request, reply) => {
    const query = backSchema.safeParse(request.query);
    const { code, state, error, iss } = query.success ? query.data : {};
    const goTo = (page: { party?: string; said: Record<string, string> }) =>
      reply
        .code(HTTP_FOUND)
        .header('location', `${OUTSIDE_PARTIES_PATH}${page.party === undefined ? '' : `/${encodeURIComponent(page.party)}`}?${new URLSearchParams(page.said).toString()}`)
        .send();
    const completed = await deps.complete({ code, state, error, iss, signIn: cookieValueOf(SHARED_SIGN_IN_COOKIE, request.headers.cookie) });
    if (completed.isOk) {
      const { fleetId, party, statementRefusal } = completed.value;
      if (statementRefusal !== null) {
        deps.log.warn({ fleetId, party, reason: statementRefusal }, "the proxy ship was not stated from a person's new grant");
      }
      return goTo({ party, said: { fleet: fleetId, 'sign-in': 'signed-in' } });
    }
    const refusal = completed.error;
    const serverError: Record<string, string> = refusal.serverError !== null && ERROR_CODE.test(refusal.serverError) ? { error: refusal.serverError } : {};
    const said: Record<string, string> = { 'sign-in': OUTCOMES[refusal.kind], ...serverError };
    return refusal.at === null ? goTo({ said }) : goTo({ party: refusal.at.party, said: { fleet: refusal.at.fleetId, ...said } });
  });
}
