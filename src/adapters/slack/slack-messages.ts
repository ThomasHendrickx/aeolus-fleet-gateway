/**
 * A bot's posts in Slack, with its bot token: a message only one person
 * sees in a conversation (chat.postEphemeral), its text as a section and a
 * button that opens an address, if any; a message in a thread
 * (chat.postMessage); and a reaction (reactions.add).
 */
import { z } from 'zod';

import { ok } from '../../core/shared/result.js';
import type { SlackMessages } from '../../core/slack/ports.js';
import { createSlackCall } from './slack-call.js';

const postedSchema = z.object({ ok: z.literal(true) });

/** Slack's refusal of a reaction the message carries already: what was asked holds. */
const ALREADY_REACTED = 'already_reacted';

export function createSlackMessages(options: { apiUrl: string }): SlackMessages {
  const call = createSlackCall(options.apiUrl);
  return {
    postOnlyTo: async (botToken, { channel, user, text, button }) => {
      const form: Record<string, string> = { channel, user, text };
      if (button !== undefined) {
        form.blocks = JSON.stringify([
          { type: 'section', text: { type: 'mrkdwn', text } },
          { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: button.text }, url: button.url, style: 'primary' }] },
        ]);
      }
      const posted = await call({ method: 'chat.postEphemeral', form, token: botToken }, postedSchema);
      return posted.isOk ? ok(undefined) : posted;
    },
    postInThread: async (botToken, { channel, threadTs, text }) => {
      const posted = await call({ method: 'chat.postMessage', form: { channel, thread_ts: threadTs, text }, token: botToken }, postedSchema);
      return posted.isOk ? ok(undefined) : posted;
    },
    react: async (botToken, { channel, ts, name }) => {
      const reacted = await call({ method: 'reactions.add', form: { channel, timestamp: ts, name }, token: botToken }, postedSchema);
      return reacted.isOk || (reacted.error.kind === 'refused' && reacted.error.error === ALREADY_REACTED) ? ok(undefined) : reacted;
    },
  };
}
