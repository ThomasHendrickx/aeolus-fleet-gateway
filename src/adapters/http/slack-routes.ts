/**
 * Slack's doors at the gateway (gateway scopes, part B): `/gw/slack/install`
 * is where Slack's install screen sends the person back with a code and the
 * state the gateway sealed. The person goes on to the Slack page, which says
 * how the install went by its outcome in the address, never by a text the
 * address carries. `/gw/slack/link` is where Sign in with Slack sends them
 * back to link, with the browser's shared sign-in so the link binds to the
 * account that started it, going on to the Overview the same way; a link refused for
 * one kept already carries the first link's name. `/gw/slack/events` takes
 * the events of the apps the gateway made, each read as its raw body so its
 * signature can be checked.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { SHARED_SIGN_IN_COOKIE } from '../../core/account-sign-in/ports.js';
import type { CompleteInstall } from '../../core/slack/complete-install.js';
import type { CompleteLink } from '../../core/slack/complete-link.js';
import type { TakeSlackEvent } from '../../core/slack/take-slack-event.js';
import { cookieValueOf } from './account-sign-in-routes.js';

export const SLACK_INSTALL_PATH = '/gw/slack/install';

export const SLACK_EVENTS_PATH = '/gw/slack/events';

export const SLACK_LINK_PATH = '/gw/slack/link';

/** The Slack page of the web app (web/features/slack/paths.ts names the same). */
const SLACK_PAGE_PATH = '/slack';

/** The Overview of the web app, where a person's Slack link shows. */
const OVERVIEW_PATH = '/overview';

const HTTP_FOUND = 302;
const HTTP_UNAUTHORIZED = 401;
const HTTP_BAD_REQUEST = 400;

/** Slack's address check as it makes an app, before the gateway knows the app's signing secret: it carries nothing to act on. */
const urlVerificationSchema = z.object({ type: z.literal('url_verification'), challenge: z.string() });

const eventCallbackSchema = z.object({
  type: z.literal('event_callback'),
  api_app_id: z.string(),
  team_id: z.string(),
  event: z.object({
    type: z.string(),
    user: z.string().optional(),
    channel: z.string().optional(),
    channel_type: z.string().optional(),
    subtype: z.string().optional(),
    bot_id: z.string().optional(),
  }),
});

function headerOf(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

const installQuerySchema = z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() });

/** What the Overview says of a link, by its outcome (web/features/overview/services/slack-link-outcomes.ts). */
const LINK_OUTCOMES = {
  LINK_REFUSED: 'refused',
  SLACK_NOT_CONNECTED: 'not-connected',
  NO_SUCH_BOT: 'not-connected',
  OTHER_WORKSPACE: 'other-workspace',
  SLACK_UNAVAILABLE: 'unavailable',
  SLACK_USER_LINKED: 'slack-user-linked',
  ACCOUNT_LINKED: 'account-linked',
} as const;

/** What the Slack page says of an install, by its outcome (web/features/slack/install-outcomes.ts). */
const OUTCOMES = {
  INSTALL_REFUSED: 'refused',
  SLACK_NOT_CONNECTED: 'not-connected',
  OTHER_WORKSPACE: 'other-workspace',
  SLACK_UNAVAILABLE: 'unavailable',
} as const;

export function registerSlackRoutes(server: FastifyInstance, deps: { completeInstall: CompleteInstall; completeLink: CompleteLink; takeSlackEvent: TakeSlackEvent }): void {
  server.get(SLACK_INSTALL_PATH, async (request, reply) => {
    const query = installQuerySchema.safeParse(request.query);
    const { code, state, error } = query.success ? query.data : {};
    const goTo = (outcome: string, fleetId?: string) => reply.code(HTTP_FOUND).header('location', `${SLACK_PAGE_PATH}?${new URLSearchParams({ ...(fleetId === undefined ? {} : { fleet: fleetId }), install: outcome }).toString()}`).send();
    if (error !== undefined || code === undefined || state === undefined) {
      // The person cancelled on Slack's screen, or Slack sent nothing to take.
      return goTo('cancelled');
    }
    const completed = await deps.completeInstall({ code, state });
    return completed.isOk ? goTo('installed', completed.value.fleetId) : goTo(OUTCOMES[completed.error.kind]);
  });

  server.get(SLACK_LINK_PATH, async (request, reply) => {
    const query = installQuerySchema.safeParse(request.query);
    const { code, state, error } = query.success ? query.data : {};
    const goTo = (said: Record<string, string>) => reply.code(HTTP_FOUND).header('location', `${OVERVIEW_PATH}?${new URLSearchParams(said).toString()}`).send();
    if (error !== undefined || code === undefined || state === undefined) {
      // The person cancelled on Slack's screen, or Slack sent nothing to take.
      return goTo({ slack: 'cancelled' });
    }
    const completed = await deps.completeLink({ code, state, signIn: cookieValueOf(SHARED_SIGN_IN_COOKIE, request.headers.cookie) });
    if (completed.isOk) {
      return goTo({ fleet: completed.value.fleetId, slack: 'linked' });
    }
    const refusal = completed.error;
    return 'name' in refusal ? goTo({ fleet: refusal.fleetId, slack: LINK_OUTCOMES[refusal.kind], name: refusal.name }) : goTo({ slack: LINK_OUTCOMES[refusal.kind] });
  });

  void server.register(async (scope) => {
    // The raw body, as Slack signed it.
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, async (_request: unknown, body: string | Buffer) => Promise.resolve(body.toString()));
    scope.post(SLACK_EVENTS_PATH, async (request, reply) => {
      const body = typeof request.body === 'string' ? request.body : '';
      let sent: unknown;
      try {
        sent = JSON.parse(body);
      } catch {
        return reply.code(HTTP_BAD_REQUEST).send();
      }
      const check = urlVerificationSchema.safeParse(sent);
      if (check.success) {
        return reply.send({ challenge: check.data.challenge });
      }
      const event = eventCallbackSchema.safeParse(sent);
      if (!event.success) {
        return reply.code(HTTP_BAD_REQUEST).send();
      }
      const { api_app_id: appId, team_id: teamId, event: fields } = event.data;
      const taken = await deps.takeSlackEvent({
        appId,
        event: { type: fields.type, teamId, userId: fields.user ?? null, channel: fields.channel ?? null, channelType: fields.channel_type ?? null, subtype: fields.subtype ?? null, botId: fields.bot_id ?? null },
        isRetry: request.headers['x-slack-retry-num'] !== undefined,
        body,
        timestamp: headerOf(request.headers['x-slack-request-timestamp']),
        signature: headerOf(request.headers['x-slack-signature']),
      });
      return taken.isOk ? reply.send() : reply.code(HTTP_UNAUTHORIZED).send();
    });
    return Promise.resolve();
  });
}
