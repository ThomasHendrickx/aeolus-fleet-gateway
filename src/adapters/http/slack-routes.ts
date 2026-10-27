/**
 * Slack's doors at the gateway (gateway scopes, part B): `/gw/slack/install`
 * is where Slack's install screen sends the person back with a code and the
 * state the gateway sealed. The person goes on to the Slack page, which says
 * how the install went by its outcome in the address, never by a text the
 * address carries. `/gw/slack/events` takes the events of the apps the
 * gateway made, each read as its raw body so its signature can be checked.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { CompleteInstall } from '../../core/slack/complete-install.js';
import type { TakeSlackEvent } from '../../core/slack/take-slack-event.js';

export const SLACK_INSTALL_PATH = '/gw/slack/install';

export const SLACK_EVENTS_PATH = '/gw/slack/events';

/** The Slack page of the web app (web/features/slack/paths.ts names the same). */
const SLACK_PAGE_PATH = '/slack';

const HTTP_FOUND = 302;
const HTTP_UNAUTHORIZED = 401;
const HTTP_BAD_REQUEST = 400;

/** Slack's address check as it makes an app, before the gateway knows the app's signing secret: it carries nothing to act on. */
const urlVerificationSchema = z.object({ type: z.literal('url_verification'), challenge: z.string() });

const eventCallbackSchema = z.object({ type: z.literal('event_callback'), api_app_id: z.string(), event: z.object({ type: z.string() }) });

function headerOf(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

const installQuerySchema = z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() });

/** What the Slack page says of an install, by its outcome (web/features/slack/install-outcomes.ts). */
const OUTCOMES = {
  INSTALL_REFUSED: 'refused',
  SLACK_NOT_CONNECTED: 'not-connected',
  OTHER_WORKSPACE: 'other-workspace',
  SLACK_UNAVAILABLE: 'unavailable',
} as const;

export function registerSlackRoutes(server: FastifyInstance, deps: { completeInstall: CompleteInstall; takeSlackEvent: TakeSlackEvent }): void {
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
      const taken = await deps.takeSlackEvent({
        appId: event.data.api_app_id,
        eventType: event.data.event.type,
        body,
        timestamp: headerOf(request.headers['x-slack-request-timestamp']),
        signature: headerOf(request.headers['x-slack-signature']),
      });
      return taken.isOk ? reply.send() : reply.code(HTTP_UNAUTHORIZED).send();
    });
    return Promise.resolve();
  });
}
