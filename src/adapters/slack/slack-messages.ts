/**
 * A bot's posts in Slack, with its bot token: a message only one person
 * sees in a conversation (chat.postEphemeral), its text as a section and a
 * button that opens an address, if any; a message in a conversation or a
 * thread, with a button per option under a question (chat.postMessage);
 * a reaction (reactions.add); and a message's text read (conversations.history,
 * or conversations.replies in a thread) and given anew, its buttons gone
 * (chat.update).
 */
import { z } from 'zod';

import { err, ok } from '../../core/shared/result.js';
import type { SlackMessages } from '../../core/slack/ports.js';
import { createSlackCall } from './slack-call.js';

const postedSchema = z.object({ ok: z.literal(true) });

const postedMessageSchema = z.object({ ok: z.literal(true), channel: z.string(), ts: z.string() });

const messagesSchema = z.object({ ok: z.literal(true), messages: z.array(z.object({ ts: z.string(), text: z.string() })) });

/** What the gateway says when Slack answers no message at the time asked, as Slack names a message it does not have. */
const MESSAGE_NOT_FOUND = 'message_not_found';

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
    post: async (botToken, { messageId, channel, threadTs, text, buttons }) => {
      const form: Record<string, string> = { channel, text };
      if (threadTs !== null) {
        form.thread_ts = threadTs;
      }
      if (buttons.length > 0) {
        form.blocks = JSON.stringify([
          { type: 'section', text: { type: 'mrkdwn', text } },
          { type: 'actions', block_id: messageId, elements: buttons.map(({ text: label, option }) => ({ type: 'button', action_id: `answer-${String(option)}`, text: { type: 'plain_text', text: label }, value: String(option) })) },
        ]);
      }
      const posted = await call({ method: 'chat.postMessage', form, token: botToken }, postedMessageSchema);
      return posted.isOk ? ok({ channel: posted.value.channel, ts: posted.value.ts }) : posted;
    },
    postInThread: async (botToken, { channel, threadTs, text }) => {
      const posted = await call({ method: 'chat.postMessage', form: { channel, thread_ts: threadTs, text }, token: botToken }, postedSchema);
      return posted.isOk ? ok(undefined) : posted;
    },
    react: async (botToken, { channel, ts, name }) => {
      const reacted = await call({ method: 'reactions.add', form: { channel, timestamp: ts, name }, token: botToken }, postedSchema);
      return reacted.isOk || (reacted.error.kind === 'refused' && reacted.error.error === ALREADY_REACTED) ? ok(undefined) : reacted;
    },
    textOf: async (botToken, { channel, ts, threadTs }) => {
      // Between its own time and itself, inclusive: the message alone, and in a thread its first message too.
      const between = { channel, oldest: ts, latest: ts, inclusive: 'true' };
      const read = await call(threadTs === null ? { method: 'conversations.history', form: { ...between, limit: '1' }, token: botToken } : { method: 'conversations.replies', form: { ...between, ts: threadTs }, token: botToken }, messagesSchema);
      if (!read.isOk) {
        return read;
      }
      const message = read.value.messages.find((each) => each.ts === ts);
      return message === undefined ? err({ kind: 'refused', error: MESSAGE_NOT_FOUND }) : ok(message.text);
    },
    update: async (botToken, { channel, ts, text }) => {
      const updated = await call({ method: 'chat.update', form: { channel, ts, text, blocks: '[]' }, token: botToken }, postedSchema);
      return updated.isOk ? ok(undefined) : updated;
    },
  };
}
