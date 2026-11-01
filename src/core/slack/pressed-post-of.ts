/**
 * A question's post as a press in Slack sends its answer
 * (aeolus-fleet#1573): while it is sent, the option and to whom, its
 * buttons gone so it is not pressed twice; once the fleet did not take it,
 * why, its buttons back to press again. Both keep the post's heading, title
 * and context; the line under them says it, in place of the asker's pick.
 */
import { optionTextOf } from './edited-post-of.js';
import type { SlackItem, SlackMessage } from './ports.js';
import { escaped } from './slack-post-of.js';

/** A post that frames an item, as a question's does. */
export type ItemPost = SlackMessage & { readonly item: SlackItem };

/** The post while the option pressed, named in full, is sent to the asker. */
export function sendingPostOf(post: ItemPost, option: number): SlackMessage {
  return { ...post, item: { ...post.item, aside: `Sending *${optionTextOf(post, option)}* to ${escaped(post.item.asker)}…` }, buttons: [] };
}

/** The post once the fleet did not take the answer, with the reason it gave. */
export function notSentPostOf(post: ItemPost, reason: string): SlackMessage {
  return { ...post, item: { ...post.item, aside: `⚠️ Not sent: ${escaped(reason)}. Press an option to try again.` } };
}
