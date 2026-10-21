/**
 * The doors of the shared account sign-in for the gateway's pages (header
 * design H5): `/sign-in/start` sends the browser to pagasae, `/sign-in/done`
 * takes it back to the page it asked for, and `/sign-in/end` signs it out of
 * every Aeolus app. What went wrong is the web app's page to say, at
 * `/sign-in/failed`.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import type { CompleteAccountSignIn } from '../../core/account-sign-in/complete-account-sign-in.js';
import { SHARED_SIGN_IN_COOKIE } from '../../core/account-sign-in/ports.js';
import type { SignOutAccount } from '../../core/account-sign-in/sign-out-account.js';
import type { StartAccountSignIn } from '../../core/account-sign-in/start-account-sign-in.js';
import { SIGN_IN_LIFETIME_MS } from '../../core/sign-in/start-sign-in.js';
import { isSameOrigin } from './html.js';

const HTTP_FOUND = 302;
const HTTP_SEE_OTHER = 303;
const HTTP_FORBIDDEN = 403;
const MS_PER_SECOND = 1000;

const START = '/sign-in/start';
const DONE = '/sign-in/done';
const END = '/sign-in/end';
const FAILED = '/sign-in/failed';

/** The cookie the browser that started a sign-in holds its secret in, sent back to the way back only. Lax, so it comes back on pagasae's redirect. */
const SIGN_IN_COOKIE = 'aeolus_account_sign_in';

const fieldsSchema = z.record(z.string(), z.string());

function fieldsOf(value: unknown): Record<string, string> {
  const fields = fieldsSchema.safeParse(value);
  return fields.success ? fields.data : {};
}

/** A cookie's value from a Cookie header, if the browser sent it. */
export function cookieValueOf(name: string, header: string | undefined): string | undefined {
  const prefix = `${name}=`;
  const value = header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
  return value === '' ? undefined : value;
}

export function registerAccountSignIn(server: FastifyInstance, deps: { issuer: string; start: StartAccountSignIn; complete: CompleteAccountSignIn; signOut: SignOutAccount }): void {
  const secure = new URL(deps.issuer).protocol === 'https:' ? ' Secure;' : '';
  const signInCookie = (value: string, maxAgeSeconds: number) => `${SIGN_IN_COOKIE}=${value}; Path=${DONE}; Max-Age=${String(maxAgeSeconds)}; HttpOnly;${secure} SameSite=Lax`;
  const failed = (reply: FastifyReply, reason: string) => reply.code(HTTP_FOUND).header('location', `${FAILED}?${new URLSearchParams({ reason }).toString()}`);

  server.get(START, (request, reply) => {
    const started = deps.start({ returnTo: fieldsOf(request.query).return_to });
    return reply.code(HTTP_FOUND).header('location', started.redirectTo).header('set-cookie', signInCookie(started.browserSecret, SIGN_IN_LIFETIME_MS / MS_PER_SECOND)).send();
  });

  server.get(DONE, async (request, reply) => {
    const { state, code, error } = fieldsOf(request.query);
    const completed = await deps.complete({ state, code, error, browserSecret: cookieValueOf(SIGN_IN_COOKIE, request.headers.cookie) });
    void reply.header('set-cookie', signInCookie('', 0));
    if (!completed.isOk) {
      return failed(reply, completed.error.kind).send();
    }
    return reply.code(HTTP_FOUND).header('location', completed.value.redirectTo).send();
  });

  server.post(END, async (request, reply) => {
    if (!isSameOrigin(request)) {
      return reply.code(HTTP_FORBIDDEN).type('text/plain; charset=utf-8').send("Signing out is sent only from the gateway's own pages.");
    }
    const signIn = cookieValueOf(SHARED_SIGN_IN_COOKIE, request.headers.cookie);
    if (signIn !== undefined) {
      const ended = await deps.signOut(signIn);
      if (!ended.isOk) {
        return reply.code(HTTP_SEE_OTHER).header('location', `${FAILED}?${new URLSearchParams({ reason: 'signOutUnavailable' }).toString()}`).send();
      }
    }
    return reply.code(HTTP_SEE_OTHER).header('location', START).send();
  });
}
