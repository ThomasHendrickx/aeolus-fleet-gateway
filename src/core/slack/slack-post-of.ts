import { QUESTION_CONTENT_TYPE, questionSchema } from '@aeolus-fleet/common';

import { jobOf } from '../people/item-job.js';
import type { PersonDelivery } from '../people/ports.js';
import type { SlackButton } from './ports.js';

/** The most a Slack message shows in full. */
export const MESSAGE_MAX_LENGTH = 40_000;

/** The most one block of a Slack message shows. */
export const BLOCK_MAX_LENGTH = 3_000;

/** What a delivery shows as in Slack: its text in Slack's markup, or a link to the gateway for what Slack does not show in full; with a button per option, or Seen. */
export interface SlackShown {
  readonly kind: 'shown' | 'link';
  readonly text: string;
  readonly buttons: readonly SlackButton[];
}

/** The button under an item with no other: seeing it is what it asks, or all the person does with it in Slack (Bridge, section 6). */
export const SEEN: SlackButton = { text: 'Seen', isSeen: true };

/** The buttons of an item that shows no option: Seen, but for a question or a step, which seeing does not end. */
function seenOf(contentType: string): SlackButton[] {
  const job = jobOf(contentType);
  return job === 'stay-aware' || job === 'everything-else' ? [SEEN] : [];
}

/** The content type's essence, its parameters gone. */
function essenceOf(contentType: string): string {
  return (contentType.split(';')[0] ?? '').trim().toLowerCase();
}

/** Text as Slack shows it as it is: its control characters escaped. */
function escaped(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** Markdown in Slack's markup: bold, strike, links and headings; italics, code and lists read the same. */
function slackMarkupOf(markdown: string): string {
  return escaped(markdown)
    .replaceAll(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<$2|$1>')
    .replaceAll(/\*\*([^*\n]+)\*\*/g, '*$1*')
    .replaceAll(/__([^_\n]+)__/g, '*$1*')
    .replaceAll(/~~([^~\n]+)~~/g, '~$1~')
    .replaceAll(/^#{1,6} +(.+)$/gm, '*$1*');
}

/**
 * What a delivery shows as in Slack (gateway scopes 9.5 step 2): text and
 * Markdown as text, Markdown in Slack's markup; a question as its title and
 * context, one button per option; JSON as a code block. Another content
 * type, or more than Slack shows in full (40,000 characters, a block 3,000),
 * goes as a link to the gateway's pages. The gateway's own bot heads it
 * with the sender's name. An item with no other button, an alert, a notice
 * or any other message, gets Seen.
 */
export function slackPostOf(delivery: PersonDelivery, shown: { bridgeUrl: string; isHeadedBySender: boolean }): SlackShown {
  const { senderName, contentType, payload } = delivery;
  const link: SlackShown = { kind: 'link', text: `${escaped(senderName)} sent you a message Slack does not show in full: <${shown.bridgeUrl}|open it in the gateway>`, buttons: seenOf(contentType) };
  const headed = (text: string) => (shown.isHeadedBySender ? `*${escaped(senderName)}*\n${text}` : text);
  const essence = essenceOf(contentType);
  let text: string;
  let buttons = seenOf(contentType);
  if (essence === 'text/plain') {
    text = escaped(payload);
  } else if (essence === 'text/markdown') {
    text = slackMarkupOf(payload);
  } else if (essence === 'application/json') {
    text = `\`\`\`${payload}\`\`\``;
  } else if (essence === QUESTION_CONTENT_TYPE) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return link;
    }
    const question = questionSchema.safeParse(parsed);
    if (!question.success) {
      return link;
    }
    text = `*${escaped(question.data.title)}*\n${escaped(question.data.context)}`;
    buttons = question.data.options.map(({ key, label }) => ({ text: label, option: key }));
    if (headed(text).length > BLOCK_MAX_LENGTH) {
      return link;
    }
  } else {
    return link;
  }
  const full = headed(text);
  return full.length > MESSAGE_MAX_LENGTH ? link : { kind: 'shown', text: full, buttons };
}
