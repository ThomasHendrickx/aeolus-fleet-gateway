/**
 * What waits at argo as Slack's post shows it (argo's inbox, AI2 to AI4,
 * mockups/slack.html): marked Waits at argo, not you, with argo's own colour,
 * its kind and sender, its headline, who it is for, and one button to the
 * console as argo, no answer buttons; then, once done at argo, by whom and
 * when, its button gone.
 */
import { isQuestionContentType } from '@aeolus-fleet/common';

import { TITLE_MAX_LENGTH } from '../people/inbox-entry.js';
import { slackTimeOf } from '../slack/edited-post-of.js';
import type { SlackMessage } from '../slack/ports.js';
import { escaped } from '../slack/slack-post-of.js';
import type { ArgoMessageRead } from './ports.js';

/** The line under the headline: it is not the person's alone, and acting takes argo's sign-in. */
const FOR_EVERYONE = 'For everyone allowed as argo. Acting signs you in to the console as argo.';

const OPEN_AS_ARGO = 'Open in the console as argo';

/** The headline, cut to fit as an inbox shows a title (#1570). */
function titleOf(headline: string): string {
  return headline.length <= TITLE_MAX_LENGTH ? headline : `${headline.slice(0, TITLE_MAX_LENGTH - 1)}…`;
}

/** Slack's post of a message open at argo, its button to the message in the console as argo (A1's link). */
export function argoSlackMessageOf(message: ArgoMessageRead, argoMessageUrl: string): SlackMessage {
  const kind = isQuestionContentType(message.contentType) ? 'Question' : 'Report';
  const title = escaped(titleOf(message.headline));
  return {
    text: `Waits at argo, not you: ${title}`,
    item: { asker: message.sender.name, heading: `*Waits at argo*, not you · ${kind} from ${escaped(message.sender.name)}`, title, body: null, aside: FOR_EVERYONE, footer: null, tone: 'argo' },
    buttons: [{ text: OPEN_AS_ARGO, url: argoMessageUrl, isPlain: true }],
  };
}

/**
 * The post, as Slack holds it, edited once its message is done at argo:
 * by whom, the name of the person ship of the account signed in as argo,
 * and when, each left out when the gateway did not see it. None for a post
 * that is no item, or says so already.
 */
export function doneAtArgoMessageOf(message: SlackMessage, done: { by: string | undefined; at: Date | undefined }): SlackMessage | undefined {
  const { item } = message;
  if (item === null || item.tone === 'done') {
    return undefined;
  }
  const by = done.by === undefined ? '' : ` by ${escaped(done.by)}`;
  const at = done.at === undefined ? '' : `, ${slackTimeOf(done.at)}`;
  return { text: message.text, item: { ...item, body: `✅ Done at argo${by} in the console${at}`, aside: null, footer: null, tone: 'done' }, buttons: [] };
}
