/**
 * Slack's doors at the gateway (gateway scopes, part B): `/gw/slack/install`
 * is where Slack's install screen sends the person back with a code and the
 * state the gateway sealed. The person goes on to the Slack page, which says
 * how the install went by its outcome in the address, never by a text the
 * address carries.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { CompleteInstall } from '../../core/slack/complete-install.js';

export const SLACK_INSTALL_PATH = '/gw/slack/install';

/** The Slack page of the web app (web/features/slack/paths.ts names the same). */
const SLACK_PAGE_PATH = '/slack';

const HTTP_FOUND = 302;

const installQuerySchema = z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() });

/** What the Slack page says of an install, by its outcome (web/features/slack/install-outcomes.ts). */
const OUTCOMES = {
  INSTALL_REFUSED: 'refused',
  SLACK_NOT_CONNECTED: 'not-connected',
  OTHER_WORKSPACE: 'other-workspace',
  SLACK_UNAVAILABLE: 'unavailable',
} as const;

export function registerSlackRoutes(server: FastifyInstance, deps: { completeInstall: CompleteInstall }): void {
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
}
