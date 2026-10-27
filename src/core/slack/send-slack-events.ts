import type { CallSender } from '../mcp-in/ports.js';
import type { PersonCrews } from '../people/ports.js';
import type { Clock } from '../shared/clock.js';
import { TAKEN_KEPT_MS, UNTAKEN_KEPT_MS, type KeptSlackEvent } from './kept-slack-event.js';
import type { SlackApps, SlackEvents, SlackMessages } from './ports.js';

/** How many kept events a round sends at most. */
const ROUND_LIMIT = 50;

/** The reaction that tells the person their message reached the fleet. */
export const STORED_REACTION = 'white_check_mark';

/** The fleet's codes for a send it did not answer, or could not start: nothing was stored, so the same send goes again. */
const NOT_ANSWERED = new Set(['UNAVAILABLE', 'SERVICE_UNAVAILABLE', 'INTERNAL_SERVER_ERROR', 'TIMEOUT']);

/** The fleet's codes for a crew token that no longer works: the person ship is crewed again at their next visit, and the send goes then. */
const ENDED_CREW = new Set(['LEASE_ENDED', 'UNAUTHORIZED']);

export const NOT_REACHED_TEXT = 'This message did not reach the fleet; send it again';

export type SendSlackEvents = () => Promise<void>;

/** What the person reads in the thread when core refused their message, plainly. */
function refusalText(ship: string, refusal: { code: string; message: string }): string {
  switch (refusal.code) {
    case 'NOT_REACHABLE':
      return `You may not message ${ship}`;
    case 'UNRESOLVABLE_SELECTOR':
      return `${ship} was retired`;
    default:
      return `${ship} did not take your message: ${refusal.message}`;
  }
}

/**
 * Use case: a round of the gateway's sends from Slack into the fleet
 * (gateway scopes 9.4 steps 5 to 7, P-B2). Each kept event goes as the
 * person ship, which the gateway crews, to the bot's ship by its id, as
 * Markdown, keyed by Slack's event id so a send tried again is the same
 * send. Core stored it: the gateway reacts to the person's Slack message.
 * Core refused it: the reason goes in its thread. Core did not answer: it
 * goes again next round. Nothing builds up: a taken event's id goes an
 * hour after core took it, and an event core has not taken in 24 hours
 * goes, the person told in its thread.
 */
export function createSendSlackEvents(deps: {
  events: SlackEvents;
  apps: Pick<SlackApps, 'findByAppId'>;
  crews: Pick<PersonCrews, 'find'>;
  sender: Pick<CallSender, 'send'>;
  slack: Pick<SlackMessages, 'postInThread' | 'react'>;
  clock: Clock;
}): SendSlackEvents {
  const send = async (event: KeptSlackEvent): Promise<'taken' | 'later'> => {
    const app = await deps.apps.findByAppId(event.appId);
    const crew = await deps.crews.find(event.fleetId, event.personShipId);
    if (app === undefined || app.bot === null || crew === undefined) {
      // No bot to answer with, or no crew to send as: the event waits, and goes after 24 hours told as not reached.
      return 'later';
    }
    const where = { channel: event.channel, threadTs: event.threadTs ?? event.ts };
    const sent = await deps.sender.send(crew.crewToken, { to: event.shipId, contentType: 'text/markdown', payload: event.markdown, idempotencyKey: `slack:${event.eventId}` });
    if (sent.isOk) {
      await deps.slack.react(app.bot.token, { channel: event.channel, ts: event.ts, name: STORED_REACTION });
      return 'taken';
    }
    if (NOT_ANSWERED.has(sent.error.code) || ENDED_CREW.has(sent.error.code)) {
      return 'later';
    }
    await deps.slack.postInThread(app.bot.token, { ...where, text: refusalText(app.name, sent.error) });
    return 'taken';
  };

  const tellNotReached = async (event: KeptSlackEvent): Promise<void> => {
    const app = await deps.apps.findByAppId(event.appId);
    if (app !== undefined && app.bot !== null) {
      await deps.slack.postInThread(app.bot.token, { channel: event.channel, threadTs: event.threadTs ?? event.ts, text: NOT_REACHED_TEXT });
    }
    await deps.events.remove(event.fleetId, event.eventId);
  };

  return async () => {
    const now = deps.clock.now();
    await deps.events.forgetTaken(new Date(now.getTime() - TAKEN_KEPT_MS));
    for (const event of await deps.events.untakenSince(new Date(now.getTime() - UNTAKEN_KEPT_MS))) {
      await tellNotReached(event);
    }
    await deps.events.sendDue(send, { limit: ROUND_LIMIT, at: now });
  };
}

