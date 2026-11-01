import { outcomeTextOf } from '../people/item-outcome.js';
import type { SlackApps, SlackMessages, SlackPosts, SlackRefusal } from './ports.js';
import type { PostToEdit } from './slack-post.js';

/** What a round did: posts edited, kept for the next round, and given up. */
export type EditSlackPosts = () => Promise<{ edited: number; kept: number; givenUp: number }>;

/** How many posts a round edits at most. */
const POSTS_PAGE = 100;

type Edited = 'edited' | 'kept' | 'givenUp';

/** Whether Slack may take it later: it rate limited the call or did not answer. */
function isForLater(refusal: SlackRefusal): boolean {
  return refusal.kind !== 'refused';
}

/**
 * Use case: view sync in Slack (Bridge, section 7). Once something came of
 * an item in any place, as answered in Bridge or seen in Slack, its post in
 * Slack is edited to say so: its text as Slack holds it, read there so the
 * gateway keeps no copy of a payload (decision 0040), with a line saying
 * what was done and where, its buttons gone. A line the text ends with
 * already, as another gateway edited it, is not added again. Slack rate
 * limiting or not answering keeps the post for the next round; Slack
 * refusing it, as for a message deleted there, or its bot removed, gives
 * it up: that place dropped out, and Bridge still has the item.
 */
export function createEditSlackPosts(deps: { posts: Pick<SlackPosts, 'toEdit' | 'markEdited'>; apps: Pick<SlackApps, 'find'>; slack: Pick<SlackMessages, 'textOf' | 'update'> }): EditSlackPosts {
  const editOne = async ({ post, outcome }: PostToEdit): Promise<Edited> => {
    const app = await deps.apps.find(post.fleetId, post.appId);
    if (app === undefined || app.bot === null || app.removedInSlackAt !== null) {
      return 'givenUp';
    }
    const where = { channel: post.channel, ts: post.ts };
    const text = await deps.slack.textOf(app.bot.token, { ...where, threadTs: post.threadTs });
    if (!text.isOk) {
      return isForLater(text.error) ? 'kept' : 'givenUp';
    }
    const line = `_${outcomeTextOf(outcome)}_`;
    const updated = await deps.slack.update(app.bot.token, { ...where, text: text.value.endsWith(line) ? text.value : `${text.value}\n\n${line}` });
    if (!updated.isOk && isForLater(updated.error)) {
      return 'kept';
    }
    return updated.isOk ? 'edited' : 'givenUp';
  };

  return async () => {
    const counted = { edited: 0, kept: 0, givenUp: 0 };
    for (const toEdit of await deps.posts.toEdit({ limit: POSTS_PAGE })) {
      const edited = await editOne(toEdit);
      if (edited !== 'kept') {
        await deps.posts.markEdited(toEdit.post.fleetId, toEdit.post);
      }
      counted[edited] += 1;
    }
    return counted;
  };
}
