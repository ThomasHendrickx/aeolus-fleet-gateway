/**
 * A bot's posts in Slack, with its bot token: a message only one person
 * sees in a conversation (chat.postEphemeral), its text as a section and a
 * button that opens an address, if any; a message in a conversation or a
 * thread (chat.postMessage), an item framed as views.html draws it, in an
 * attachment whose colour marks its side, each part a block named so it
 * reads back; a reaction (reactions.add); and a message read
 * (conversations.history, or conversations.replies in a thread) and given
 * anew, its buttons gone (chat.update).
 */
import { z } from 'zod';

import { err, ok } from '../../core/shared/result.js';
import type { SlackButton, SlackItem, SlackMessage, SlackMessages, SlackTone } from '../../core/slack/ports.js';
import { createSlackCall } from './slack-call.js';

const postedSchema = z.object({ ok: z.literal(true) });

/** What a press of Seen says it pressed, as the actions route reads it. */
export const SEEN_ACTION = 'seen';

/** What a press of a step's Done says it pressed, as the actions route reads it. */
export const DONE_ACTION = 'done';

/** What a press of a step's Open says it pressed: Slack opens its link, and the gateway takes no action. */
const OPEN_ACTION = 'open';

/** The colour at an item's side, as views.html draws it. */
const TONE_COLORS = { asking: '#4a6fa5', aware: '#9a9b9e', done: '#2eb67d', ended: '#9a9b9e' } as const satisfies Record<SlackTone, string>;

/** An item's colour back to its side: grey reads as aware, as an ended item's post shows nothing else that differs. */
const COLOR_TONES = new Map<string, SlackTone>([
  [TONE_COLORS.asking, 'asking'],
  [TONE_COLORS.done, 'done'],
  [TONE_COLORS.aware, 'aware'],
]);

/** The heading's block, named by the asker, so an edit reads who asked. */
const FROM_PREFIX = 'from:';

/** The answer button's action, by the option it answers. */
const ANSWER_PREFIX = 'answer-';

const postedMessageSchema = z.object({ ok: z.literal(true), channel: z.string(), ts: z.string() });

/** What the gateway says when Slack answers no message at the time asked, as Slack names a message it does not have. */
const MESSAGE_NOT_FOUND = 'message_not_found';

/** A button as Slack shows it: an option, named by its number, the pick's filled; Open on a link, filled; Done; or Seen. */
function elementOf(button: SlackButton) {
  const text = { type: 'plain_text', text: button.text };
  if ('option' in button) {
    const option = String(button.option);
    return { type: 'button', action_id: `${ANSWER_PREFIX}${option}`, text, value: option, ...(button.isPicked ? { style: 'primary' } : {}) };
  }
  if ('url' in button) {
    return { type: 'button', action_id: OPEN_ACTION, text, url: button.url, value: OPEN_ACTION, style: 'primary' };
  }
  return 'isDone' in button ? { type: 'button', action_id: DONE_ACTION, text, value: DONE_ACTION } : { type: 'button', action_id: SEEN_ACTION, text, value: SEEN_ACTION };
}

function contextOf(blockId: string, text: string) {
  return { type: 'context', block_id: blockId, elements: [{ type: 'mrkdwn', text }] };
}

function sectionOf(blockId: string, text: string) {
  return { type: 'section', block_id: blockId, text: { type: 'mrkdwn', text } };
}

/** An item as an attachment: its side's colour, what a notification says, then its heading, title, lines and buttons, each a block named so it reads back. */
function attachmentOf(messageId: string, { text, item, buttons }: SlackMessage & { item: SlackItem }) {
  const { asker, heading, title, body, aside, footer, tone } = item;
  const blocks = [
    contextOf(`${FROM_PREFIX}${asker}`, heading),
    sectionOf('title', `*${title}*`),
    ...(body === null ? [] : [sectionOf('body', body)]),
    ...(aside === null ? [] : [contextOf('aside', aside)]),
    ...(buttons.length === 0 ? [] : [{ type: 'actions', block_id: messageId, elements: buttons.map(elementOf) }]),
    ...(footer === null ? [] : [contextOf('footer', footer)]),
  ];
  return { color: TONE_COLORS[tone], fallback: text, blocks };
}

const textSchema = z.object({ text: z.string() });

/** An item's blocks as Slack holds them; anything else in them is not the gateway's and is left out. */
const blockSchema = z.object({
  type: z.string(),
  block_id: z.string().optional(),
  text: textSchema.optional(),
  elements: z.array(z.object({ action_id: z.string().optional(), text: z.union([z.string(), textSchema]).optional(), url: z.string().optional(), style: z.string().optional() })).optional(),
});

const attachmentSchema = z.object({ color: z.string().optional(), fallback: z.string().optional(), blocks: z.array(blockSchema).optional() });

const messagesSchema = z.object({ ok: z.literal(true), messages: z.array(z.object({ ts: z.string(), text: z.string(), attachments: z.array(z.unknown()).optional() })) });

type Block = z.infer<typeof blockSchema>;

/** A context's or a section's text. */
function blockTextOf(block: Block | undefined): string | null {
  const [element] = block?.elements ?? [];
  const text = block?.text?.text ?? (typeof element?.text === 'string' ? element.text : element?.text?.text);
  return text ?? null;
}

/** A button back as the gateway posted it; none for one it does not know. */
function buttonOf(element: NonNullable<Block['elements']>[number]): SlackButton | undefined {
  const text = typeof element.text === 'string' ? element.text : (element.text?.text ?? '');
  const action = element.action_id ?? '';
  if (action.startsWith(ANSWER_PREFIX)) {
    return { text, option: Number(action.slice(ANSWER_PREFIX.length)), isPicked: element.style === 'primary' };
  }
  if (action === OPEN_ACTION && element.url !== undefined) {
    return { text, url: element.url };
  }
  if (action === DONE_ACTION) {
    return { text, isDone: true };
  }
  return action === SEEN_ACTION ? { text, isSeen: true } : undefined;
}

/** A message back as the gateway posted or edited it: the item its attachment frames, or its text alone for any other. */
function messageBackOf(message: { text: string; attachments?: unknown[] | undefined }): SlackMessage {
  const attachment = attachmentSchema.safeParse(message.attachments?.[0]).data;
  const blocks = attachment?.blocks ?? [];
  const named = (blockId: string) => blocks.find((block) => block.block_id === blockId);
  const from = blocks.find((block) => block.block_id?.startsWith(FROM_PREFIX) === true);
  const title = blockTextOf(named('title'));
  if (from?.block_id === undefined || title === null) {
    return { text: message.text, item: null, buttons: [] };
  }
  const item: SlackItem = {
    asker: from.block_id.slice(FROM_PREFIX.length),
    heading: blockTextOf(from) ?? '',
    title: title.replace(/^\*(.*)\*$/s, '$1'),
    body: blockTextOf(named('body')),
    aside: blockTextOf(named('aside')),
    footer: blockTextOf(named('footer')),
    tone: COLOR_TONES.get(attachment?.color ?? '') ?? 'aware',
  };
  const buttons = blocks.filter((block) => block.type === 'actions').flatMap((block) => (block.elements ?? []).flatMap((element) => buttonOf(element) ?? []));
  return { text: attachment?.fallback ?? message.text, item, buttons };
}

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
    post: async (botToken, { messageId, channel, threadTs, message }) => {
      const { text, item, buttons } = message;
      const form: Record<string, string> = { channel };
      if (threadTs !== null) {
        form.thread_ts = threadTs;
      }
      if (item !== null) {
        // The item is all in its attachment: a text beside it would show above it.
        form.attachments = JSON.stringify([attachmentOf(messageId, { text, item, buttons })]);
      } else {
        form.text = text;
        if (buttons.length > 0) {
          form.blocks = JSON.stringify([
            { type: 'section', text: { type: 'mrkdwn', text } },
            { type: 'actions', block_id: messageId, elements: buttons.map(elementOf) },
          ]);
        }
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
    messageOf: async (botToken, { channel, ts, threadTs }) => {
      // Between its own time and itself, inclusive: the message alone, and in a thread its first message too.
      const between = { channel, oldest: ts, latest: ts, inclusive: 'true' };
      const read = await call(threadTs === null ? { method: 'conversations.history', form: { ...between, limit: '1' }, token: botToken } : { method: 'conversations.replies', form: { ...between, ts: threadTs }, token: botToken }, messagesSchema);
      if (!read.isOk) {
        return read;
      }
      const message = read.value.messages.find((each) => each.ts === ts);
      return message === undefined ? err({ kind: 'refused', error: MESSAGE_NOT_FOUND }) : ok(messageBackOf(message));
    },
    update: async (botToken, { channel, ts, message }) => {
      const { text, item } = message;
      // The buttons go: once something came of the item, there is nothing left to press.
      const form = item === null ? { channel, ts, text, blocks: '[]', attachments: '[]' } : { channel, ts, text: '', blocks: '[]', attachments: JSON.stringify([attachmentOf('', { text, item, buttons: [] })]) };
      const updated = await call({ method: 'chat.update', form, token: botToken }, postedSchema);
      return updated.isOk ? ok(undefined) : updated;
    },
  };
}
