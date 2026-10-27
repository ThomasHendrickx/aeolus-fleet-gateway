import type { Clock } from '../shared/clock.js';
import { err, ok, type Result } from '../shared/result.js';
import type { SlackApps, SlackSignatures } from './ports.js';

/** How far an event's timestamp may be from now (gateway scopes 9.4 step 1). */
export const EVENT_SKEW_MS = 5 * 60 * 1000;

const SECOND_MS = 1000;

/** The events that say a bot is no longer in Slack (gateway scopes 9.2). */
const REMOVED_EVENTS = new Set(['app_uninstalled', 'tokens_revoked']);

export type TakeSlackEvent = (event: { appId: string; eventType: string; body: string; timestamp: string; signature: string }) => Promise<Result<{ kind: 'taken' | 'ignored' }, { kind: 'notSigned' }>>;

/**
 * Use case: an event Slack sends the gateway for one of its apps. It is
 * taken only signed with that app's signing secret, its timestamp within 5
 * minutes of now. An app uninstalled or its tokens revoked is Removed in
 * Slack, its bot token forgotten. Other events are not acted on here.
 */
export function createTakeSlackEvent(deps: { apps: Pick<SlackApps, 'findByAppId' | 'save'>; signatures: SlackSignatures; clock: Clock }): TakeSlackEvent {
  return async ({ appId, eventType, body, timestamp, signature }) => {
    const app = await deps.apps.findByAppId(appId);
    const now = deps.clock.now();
    const sentAt = Number(timestamp) * SECOND_MS;
    if (app === undefined || !Number.isFinite(sentAt) || Math.abs(now.getTime() - sentAt) > EVENT_SKEW_MS || !deps.signatures.isSigned({ secret: app.signingSecret, timestamp, body, signature })) {
      return err({ kind: 'notSigned' });
    }
    if (!REMOVED_EVENTS.has(eventType)) {
      return ok({ kind: 'ignored' });
    }
    await deps.apps.save({ ...app, bot: null, removedInSlackAt: now });
    return ok({ kind: 'taken' });
  };
}
