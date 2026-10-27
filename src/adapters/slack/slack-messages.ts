/**
 * A bot's posts in Slack, with its bot token: a message only one person
 * sees in a conversation (chat.postEphemeral), its text as a section and a
 * button that opens an address, if any.
 */
import { z } from 'zod';

import { ok } from '../../core/shared/result.js';
import type { SlackMessages } from '../../core/slack/ports.js';
import { createSlackCall } from './slack-call.js';

const postedSchema = z.object({ ok: z.literal(true) });

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
  };
}
