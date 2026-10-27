import type { FleetId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { err, ok, type Result } from '../shared/result.js';
import type { SlackApps, SlackRefusal, SlackTooling } from './ports.js';
import { gatewayBotDescription, type SlackApp } from './slack-app.js';

/**
 * The fleet's own bot (B5): the one kept, or made now from its manifest and
 * kept, with the configuration access token given. Slack's refusal is
 * answered as is, and nothing is kept.
 */
export async function gatewayBotOf(
  deps: { slack: Pick<SlackTooling, 'makeApp'>; apps: Pick<SlackApps, 'gatewayBot' | 'save'>; clock: Clock; installRedirectUrl: string; linkRedirectUrl: string },
  made: { fleetId: FleetId; fleetName: string; accessToken: string },
): Promise<Result<SlackApp, SlackRefusal>> {
  const kept = await deps.apps.gatewayBot(made.fleetId);
  if (kept !== undefined) {
    return ok(kept);
  }
  const description = gatewayBotDescription(made.fleetName, deps);
  const app = await deps.slack.makeApp(made.accessToken, description);
  if (!app.isOk) {
    return err(app.error);
  }
  const bot: SlackApp = { fleetId: made.fleetId, shipId: null, ...app.value, name: description.name, madeAt: deps.clock.now(), installStartedAt: null, bot: null, removedInSlackAt: null };
  await deps.apps.save(bot);
  return ok(bot);
}
