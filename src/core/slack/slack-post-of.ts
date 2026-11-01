import { ALERT_CONTENT_TYPE, QUESTION_CONTENT_TYPE, questionSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import { essenceOf, jobOf, NOTICE_CONTENT_TYPE, STEP_CONTENT_TYPE, STEP_REPLACEMENT_CONTENT_TYPE } from '../people/item-job.js';
import type { PersonDelivery } from '../people/ports.js';
import type { SlackButton, SlackItem, SlackMessage } from './ports.js';

/** The most a Slack message shows in full. */
export const MESSAGE_MAX_LENGTH = 40_000;

/** The most one block of a Slack message shows. */
export const BLOCK_MAX_LENGTH = 3_000;

/** What a delivery shows as in Slack: an item framed as views.html draws it, its text in Slack's markup, or a link to the gateway for what Slack does not show in full; with its buttons. */
export interface SlackShown extends SlackMessage {
  readonly kind: 'shown' | 'link';
}

/** The button under an item with no other: seeing it is what it asks, or all the person does with it in Slack (Bridge, section 6). */
export const SEEN: SlackButton = { text: 'Seen', isSeen: true };

/** The button under a step that marks it done (Bridge, CC14). */
export const DONE: SlackButton = { text: 'Done', isDone: true };

/** What an item is called in its post's heading, by its content type, with its job's name (Bridge, section 6). */
const ITEMS = new Map<string, { noun: string; job: string }>([
  [QUESTION_CONTENT_TYPE, { noun: 'Question', job: 'Decide' }],
  [STEP_CONTENT_TYPE, { noun: 'Step', job: 'Do' }],
  [STEP_REPLACEMENT_CONTENT_TYPE, { noun: 'Step', job: 'Do' }],
  [ALERT_CONTENT_TYPE, { noun: 'Alert', job: 'Stay aware' }],
  [NOTICE_CONTENT_TYPE, { noun: 'Notice', job: 'Stay aware' }],
]);

/** What Slack reads of a step, as common's stepSchema words it from its release after 0.35.0 (Bridge B2); it moves to common's then. */
const stepSchema = z.object({ why: z.string(), link: z.url({ protocol: /^https?$/ }).optional() });

/** The step a delivery asks: a step's own, or the new step a step replacement asks. */
const STEP_SCHEMAS = new Map<string, z.ZodType<z.infer<typeof stepSchema>>>([
  [STEP_CONTENT_TYPE, stepSchema],
  [STEP_REPLACEMENT_CONTENT_TYPE, z.object({ step: stepSchema }).transform(({ step }) => step)],
]);

function parsedOf<T>(schema: z.ZodType<T>, payload: string): T | undefined {
  try {
    return schema.safeParse(JSON.parse(payload)).data;
  } catch {
    return undefined;
  }
}

/** The buttons of an item that shows no option: Seen, but for a question or a step, which seeing does not end. */
function seenOf(contentType: string): SlackButton[] {
  const job = jobOf(contentType);
  return job === 'stay-aware' || job === 'everything-else' ? [SEEN] : [];
}

/** Text as Slack shows it as it is: its control characters escaped. */
export function escaped(text: string): string {
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

/** What an item asks with in Slack, below its heading and title: the text, the quiet line, the line under the buttons, and the buttons. */
interface Asking {
  readonly body: string | null;
  readonly aside: string | null;
  readonly footer: string | null;
  readonly buttons: readonly SlackButton[];
}

/** What a question, a step, an alert or a notice asks with in Slack; none when its payload does not read. */
function askingOf(delivery: PersonDelivery, bridgeUrl: string): Asking | undefined {
  const { senderName, payload } = delivery;
  const essence = essenceOf(delivery.contentType);
  const openInBridge = `<${bridgeUrl}|Open in Bridge>`;
  if (essence === QUESTION_CONTENT_TYPE) {
    const question = parsedOf(questionSchema, payload);
    if (question === undefined) {
      return undefined;
    }
    return {
      body: slackMarkupOf(question.context),
      aside: `${escaped(senderName)} picks ${String(question.pick.option)}: ${escaped(question.pick.why)}`,
      footer: `${openInBridge} · reply in the thread to add a note`,
      buttons: question.options.map(({ key, label }) => ({ text: `${String(key)}. ${label}`, option: key, isPicked: key === question.pick.option })),
    };
  }
  const stepSchemaOf = STEP_SCHEMAS.get(essence);
  if (stepSchemaOf !== undefined) {
    const step = parsedOf(stepSchemaOf, payload);
    if (step === undefined) {
      return undefined;
    }
    const open: SlackButton[] = step.link === undefined ? [] : [{ text: `Open ${new URL(step.link).host}`, url: step.link }];
    return { body: slackMarkupOf(step.why), aside: null, footer: openInBridge, buttons: [...open, DONE] };
  }
  return { body: null, aside: null, footer: null, buttons: [SEEN] };
}

/**
 * An item as its post shows it (Bridge, views.html): headed by its asker
 * and job, its title, then what it asks with. A question: its context, the
 * asker's pick, a button per option numbered with the pick's filled, and
 * Open in Bridge with a thread reply as a note; a step: its why, Open on its
 * link and Done; an alert or a notice: its headline and Seen. None for any
 * other message, one with no headline, or one whose payload does not read.
 */
function itemPostOf(delivery: PersonDelivery, bridgeUrl: string): SlackShown | undefined {
  const essence = essenceOf(delivery.contentType);
  const named = ITEMS.get(essence);
  const asking = named === undefined || delivery.headline === null ? undefined : askingOf(delivery, bridgeUrl);
  if (named === undefined || delivery.headline === null || asking === undefined) {
    return undefined;
  }
  const { body, aside, footer, buttons } = asking;
  const asker = escaped(delivery.senderName);
  const title = escaped(delivery.headline);
  const isAware = jobOf(delivery.contentType) === 'stay-aware';
  const item: SlackItem = { asker: delivery.senderName, heading: `${named.noun} from ${asker} · ${named.job}`, title, body, aside, footer, tone: isAware ? 'aware' : 'asking' };
  const isInBlocks = [item.heading, title, body ?? '', aside ?? '', footer ?? ''].every((block) => block.length <= BLOCK_MAX_LENGTH);
  return isInBlocks ? { kind: 'shown', text: `${named.noun} from ${asker}: ${title}`, item, buttons } : undefined;
}

/**
 * What a delivery shows as in Slack (gateway scopes 9.5 step 2): an item,
 * a question, a step, an alert or a notice, as views.html draws it; text and
 * Markdown as text, Markdown in Slack's markup; JSON as a code block.
 * Another content type, or more than Slack shows in full (40,000
 * characters, a block 3,000), goes as a link to the gateway's pages. The
 * gateway's own bot heads a message that is no item with the sender's name.
 * An item with no other button, an alert, a notice or any other message,
 * gets Seen.
 */
export function slackPostOf(delivery: PersonDelivery, shown: { bridgeUrl: string; isHeadedBySender: boolean }): SlackShown {
  const { senderName, contentType, payload } = delivery;
  const link: SlackShown = { kind: 'link', text: `${escaped(senderName)} sent you a message Slack does not show in full: <${shown.bridgeUrl}|open it in the gateway>`, item: null, buttons: seenOf(contentType) };
  if (ITEMS.has(essenceOf(contentType))) {
    return itemPostOf(delivery, shown.bridgeUrl) ?? link;
  }
  const essence = essenceOf(contentType);
  let text: string;
  if (essence === 'text/plain') {
    text = escaped(payload);
  } else if (essence === 'text/markdown') {
    text = slackMarkupOf(payload);
  } else if (essence === 'application/json') {
    text = `\`\`\`${payload}\`\`\``;
  } else {
    return link;
  }
  const full = shown.isHeadedBySender ? `*${escaped(senderName)}*\n${text}` : text;
  return full.length > MESSAGE_MAX_LENGTH ? link : { kind: 'shown', text: full, item: null, buttons: seenOf(contentType) };
}
