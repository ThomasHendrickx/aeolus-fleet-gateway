import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { memoryItemOutcomes } from '../../../test/support/people-fakes.js';
import { aSlackApp, fakeSlackMessages, memorySlackApps, memorySlackPosts } from '../../../test/support/slack-fakes.js';
import type { ItemOutcome } from '../people/item-outcome.js';
import { createEditSlackPosts } from './edit-slack-posts.js';
import type { SlackButton, SlackItem } from './ports.js';

// View sync (Bridge, section 7): after the person's action in any place, a
// post of that item in Slack is edited to show what was done and where, its
// buttons gone. An item's post keeps its heading and title, as views.html
// draws it; a message that is no item keeps its text with a line under it.

const AT = new Date('2026-10-31T19:58:00.000Z');
const MATHILDE_SHIP: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9m4t';
const QUESTION_DELIVERY = 'dlv_01m3tbfspe96yf1rnr4ank0002';
const QUESTION_MESSAGE = 'msg_01m3tbfspe96yf1rnr4ank0002';
const QUESTION_TEXT = '*Which design do we build?*\nThree options, see the PR';
const BRIDGE_URL = 'https://gateway.acme.test/bridge?fleet=flt_01m3tb1zgr5h2ffee12xnch8sv';
/** 19:58 UTC on 31 Oct 2026 as Slack shows a time in each reader's own clock, with the time in UTC for a reader it cannot. */
const AT_IN_SLACK = '<!date^1793476680^{time}|19:58 UTC>';
const ITEM: SlackItem = {
  asker: 'orchestrator-1',
  heading: 'Question from orchestrator-1 · Decide',
  title: 'Which goes first?',
  body: 'Both touch the same parts',
  aside: 'orchestrator-1 picks 1: drawn on Compact already',
  footer: `<${BRIDGE_URL}|Open in Bridge> · reply in the thread to add a note`,
  tone: 'asking',
};
const ITEM_BUTTONS = [{ text: '1. Compact first', option: 1, isPicked: true }, { text: '2. Harbour first', option: 2, isPicked: false }] as const;

let apps: ReturnType<typeof memorySlackApps>;
let outcomes: ReturnType<typeof memoryItemOutcomes>;
let posts: ReturnType<typeof memorySlackPosts>;
let slack: ReturnType<typeof fakeSlackMessages>;
let editSlackPosts: ReturnType<typeof createEditSlackPosts>;

beforeEach(async () => {
  apps = memorySlackApps();
  outcomes = memoryItemOutcomes();
  posts = memorySlackPosts(outcomes);
  slack = fakeSlackMessages();
  await apps.save(aSlackApp({ appId: 'A01', bot: { token: 'xoxb-1', userId: 'U01' } }));
  const posted = await slack.messages.post('xoxb-1', { messageId: QUESTION_MESSAGE, channel: 'D0MATHILDE', threadTs: null, message: { text: QUESTION_TEXT, item: null, buttons: [{ text: 'A', option: 1, isPicked: false }, { text: 'B', option: 2, isPicked: false }] } });
  const ts = posted.isOk ? posted.value.ts : null;
  await posts.save({ fleetId: FLEET_ID, personShipId: MATHILDE_SHIP, messageId: QUESTION_MESSAGE, deliveryId: QUESTION_DELIVERY, senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9qrc', appId: 'A01', channel: 'D0MATHILDE', ts, threadTs: null });
  editSlackPosts = createEditSlackPosts({ posts, apps, slack: slack.messages, bridgeUrlOf: () => BRIDGE_URL });
});

function answeredInBridge() {
  return outcomes.save({ fleetId: FLEET_ID, shipId: MATHILDE_SHIP, deliveryId: QUESTION_DELIVERY, place: 'bridge', kind: 'answered', option: 2, at: AT });
}

/** The item's post in place of the message, as the gateway posts a question. */
async function postedAsItem(buttons: readonly SlackButton[] = ITEM_BUTTONS) {
  slack.state.posts.length = 0;
  await slack.messages.post('xoxb-1', { messageId: QUESTION_MESSAGE, channel: 'D0MATHILDE', threadTs: null, message: { text: 'Question from orchestrator-1: Which goes first?', item: ITEM, buttons } });
}

function outcomeOf(outcome: Pick<ItemOutcome, 'place' | 'kind' | 'option'>) {
  return outcomes.save({ fleetId: FLEET_ID, shipId: MATHILDE_SHIP, deliveryId: QUESTION_DELIVERY, ...outcome, at: AT });
}

/** What the edit made of the item: its body, the line under it, and its side. */
function editedItem() {
  const item = slack.state.edits.at(-1)?.message.item;
  return item === undefined || item === null ? undefined : { body: item.body, footer: item.footer, tone: item.tone };
}

describe("an item's post in Slack once something came of it (views.html)", () => {
  it('is edited to the answer given in Slack and where it shows, keeping its heading and title, its pick and buttons gone', async () => {
    await postedAsItem();
    await outcomeOf({ place: 'slack', kind: 'answered', option: 2 });

    await editSlackPosts();

    expect(slack.state.edits.map(({ message }) => message)).toEqual([
      {
        text: 'Question from orchestrator-1: Which goes first?',
        item: { ...ITEM, body: `✅ You answered at ${AT_IN_SLACK}: *2. Harbour first*, sent to orchestrator-1`, aside: null, footer: `Bridge and the chat show it answered in Slack · <${BRIDGE_URL}|Open in Bridge>`, tone: 'done' },
        buttons: [],
      },
    ]);
  });

  it('says the place it was answered in when that is not Slack', async () => {
    await postedAsItem();
    await answeredInBridge();

    await editSlackPosts();

    expect(editedItem()).toEqual({ body: `✅ You answered at ${AT_IN_SLACK}: *2. Harbour first*, sent to orchestrator-1`, footer: `Answered in Bridge · <${BRIDGE_URL}|Open in Bridge>`, tone: 'done' });
  });

  it('names the option by its number when its button is not there to read its label from', async () => {
    await postedAsItem([]);
    await answeredInBridge();

    await editSlackPosts();

    expect(editedItem()?.body).toBe(`✅ You answered at ${AT_IN_SLACK}: *option 2*, sent to orchestrator-1`);
  });

  it('says an answer of a note alone, a step done or marked cannot, an item seen, and one withdrawn, replaced or not sent', async () => {
    const said = [];
    for (const outcome of [
      { place: 'chat', kind: 'answered', option: null },
      { place: 'slack', kind: 'done', option: null },
      { place: 'bridge', kind: 'cannot', option: null },
      { place: 'slack', kind: 'seen', option: null },
      { place: 'bridge', kind: 'withdrawn', option: null },
      { place: 'bridge', kind: 'replaced', option: null },
      { place: 'bridge', kind: 'notSent', option: null },
      { place: 'gateway', kind: 'done', option: null },
    ] as const) {
      outcomes.held.length = 0;
      slack.state.edits.length = 0;
      await postedAsItem();
      posts.edited.clear();
      await outcomeOf(outcome);
      await editSlackPosts();
      said.push(editedItem());
    }

    expect(said).toEqual([
      { body: `✅ You answered at ${AT_IN_SLACK} with your note, sent to orchestrator-1`, footer: `Answered in a chat · <${BRIDGE_URL}|Open in Bridge>`, tone: 'done' },
      { body: `✅ Done at ${AT_IN_SLACK}, sent to orchestrator-1`, footer: `Bridge and the chat show it done in Slack · <${BRIDGE_URL}|Open in Bridge>`, tone: 'done' },
      { body: `Marked cannot at ${AT_IN_SLACK}, sent to orchestrator-1`, footer: `Marked cannot in Bridge · <${BRIDGE_URL}|Open in Bridge>`, tone: 'ended' },
      { body: `✅ Seen at ${AT_IN_SLACK}`, footer: `Bridge and the chat show it seen in Slack · <${BRIDGE_URL}|Open in Bridge>`, tone: 'done' },
      { body: `Withdrawn by orchestrator-1, seen at ${AT_IN_SLACK}`, footer: `Withdrawn by its asker, seen in Bridge · <${BRIDGE_URL}|Open in Bridge>`, tone: 'ended' },
      { body: `Replaced by orchestrator-1, seen at ${AT_IN_SLACK}`, footer: `Replaced by its asker, seen in Bridge · <${BRIDGE_URL}|Open in Bridge>`, tone: 'ended' },
      { body: `Not sent: removed from the basket at ${AT_IN_SLACK}`, footer: `Not sent, removed in Bridge · <${BRIDGE_URL}|Open in Bridge>`, tone: 'ended' },
      { body: `✅ Done at ${AT_IN_SLACK}`, footer: `Done by the gateway · <${BRIDGE_URL}|Open in Bridge>`, tone: 'done' },
    ]);
  });

  it('is left as it is when another gateway edited it already', async () => {
    await postedAsItem();
    await answeredInBridge();
    await slack.messages.update('xoxb-1', { channel: 'D0MATHILDE', ts: '1730020000.000001', messageId: QUESTION_MESSAGE, message: { text: 'Question from orchestrator-1: Which goes first?', item: { ...ITEM, body: 'answered elsewhere', tone: 'done' }, buttons: [] } });

    await editSlackPosts();

    expect(slack.state.edits.map(({ message }) => message.item?.body)).toEqual(['answered elsewhere']);
  });
});

describe('a post of a message that is no item in Slack, once something came of it in any place', () => {
  it('is edited to say what was done and where, keeping its text, its buttons gone', async () => {
    await answeredInBridge();

    await editSlackPosts();

    expect(slack.state.edits).toEqual([{ botToken: 'xoxb-1', channel: 'D0MATHILDE', ts: '1730020000.000001', messageId: QUESTION_MESSAGE, message: { text: `${QUESTION_TEXT}\n\n_Answered in Bridge: option 2_`, item: null, buttons: [] } }]);
  });

  it('is edited once: the next round edits nothing', async () => {
    await answeredInBridge();

    await editSlackPosts();
    await editSlackPosts();

    expect(slack.state.edits).toHaveLength(1);
  });

  it('is not edited while nothing came of its item', async () => {
    await editSlackPosts();

    expect(slack.state.edits).toEqual([]);
  });

  it('says seen in Slack for an alert seen there', async () => {
    await outcomes.save({ fleetId: FLEET_ID, shipId: MATHILDE_SHIP, deliveryId: QUESTION_DELIVERY, place: 'slack', kind: 'seen', option: null, at: AT });

    await editSlackPosts();

    expect(slack.state.edits.map(({ message }) => message.text)).toEqual([`${QUESTION_TEXT}\n\n_Seen in Slack_`]);
  });

  it('is edited at the next round when Slack rate limited the edit or did not answer', async () => {
    await answeredInBridge();
    slack.state.editRefusals.push({ kind: 'rateLimited', retryAfterSeconds: 3 }, { kind: 'unavailable', message: 'timeout' });

    await editSlackPosts();
    await editSlackPosts();
    await editSlackPosts();

    expect(slack.state.edits).toHaveLength(1);
  });

  it('adds its line once, though another gateway edited it meanwhile', async () => {
    await answeredInBridge();
    await slack.messages.update('xoxb-1', { channel: 'D0MATHILDE', ts: '1730020000.000001', messageId: QUESTION_MESSAGE, message: { text: `${QUESTION_TEXT}\n\n_Answered in Bridge: option 2_`, item: null, buttons: [] } });

    await editSlackPosts();

    expect(slack.state.edits.at(-1)?.message.text).toBe(`${QUESTION_TEXT}\n\n_Answered in Bridge: option 2_`);
  });

  it('is given up when Slack refused the edit, as for a message deleted there', async () => {
    await answeredInBridge();
    slack.state.editRefusals.push({ kind: 'refused', error: 'message_not_found' });

    await editSlackPosts();
    await editSlackPosts();

    expect(slack.state.edits).toEqual([]);
  });

  it('is given up when its bot was removed in Slack: that place dropped out', async () => {
    await apps.save(aSlackApp({ appId: 'A01', bot: { token: 'xoxb-1', userId: 'U01' }, removedInSlackAt: AT }));
    await answeredInBridge();

    await editSlackPosts();
    await apps.save(aSlackApp({ appId: 'A01', bot: { token: 'xoxb-1', userId: 'U01' } }));
    await editSlackPosts();

    expect(slack.state.edits).toEqual([]);
  });
});
