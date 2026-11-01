import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { startFakeSlack, type FakeSlack } from '../../../test/support/fake-slack.js';
import type { SlackItem, SlackMessage } from '../../core/slack/ports.js';
import { createSlackMessages } from './slack-messages.js';

// A bot's message only one person sees (chat.postEphemeral), against the
// Slack double: the text, and a button that opens an address.

let slack: FakeSlack;

/** A question as its post shows it (views.html). */
const QUESTION_POST = {
  text: 'Question from finance: Cut travel?',
  item: { asker: 'finance', heading: 'Question from finance · Decide', title: 'Cut travel?', body: 'Over by 10%', aside: 'finance picks 1: cheaper', footer: '<https://gateway.acme.test/bridge|Open in Bridge> · reply in the thread to add a note', tone: 'asking' },
  buttons: [{ text: '1. Cut', option: 1, isPicked: true }, { text: '2. Keep', option: 2, isPicked: false }],
} as const satisfies SlackMessage & { item: SlackItem };

beforeEach(async () => {
  slack = await startFakeSlack();
});

afterEach(async () => {
  await slack.stop();
});

describe("a bot's message only one person sees", () => {
  it('posts the text with a button that opens the address, to the person in the conversation', async () => {
    const posted = await createSlackMessages({ apiUrl: slack.apiUrl }).postOnlyTo('xoxb-A02', { channel: 'D0MATHILDE', user: 'U0MATHILDE', text: 'Link your Slack account', button: { text: 'Link Slack', url: 'https://gateway.acme.test/slack/link?fleet=flt_1' } });

    expect(posted).toEqual({ isOk: true, value: undefined });
    const form = slack.postedOnlyTo[0]?.form;
    const blocks: unknown = JSON.parse(form?.blocks ?? 'null');
    expect({ channel: form?.channel, user: form?.user, text: form?.text, blocks }).toEqual({
      channel: 'D0MATHILDE',
      user: 'U0MATHILDE',
      text: 'Link your Slack account',
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: 'Link your Slack account' } },
        { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Link Slack' }, url: 'https://gateway.acme.test/slack/link?fleet=flt_1', style: 'primary' }] },
      ],
    });
  });

  it('posts the text alone without a button', async () => {
    await createSlackMessages({ apiUrl: slack.apiUrl }).postOnlyTo('xoxb-A02', { channel: 'D0MATHILDE', user: 'U0MATHILDE', text: 'Your account cannot message the fleet now' });

    expect(slack.postedOnlyTo[0]?.form).toEqual({ channel: 'D0MATHILDE', user: 'U0MATHILDE', text: 'Your account cannot message the fleet now' });
  });

  it("posts in a message's thread", async () => {
    await createSlackMessages({ apiUrl: slack.apiUrl }).postInThread('xoxb-A02', { channel: 'D0MATHILDE', threadTs: '1730019600.000100', text: 'You may not message release-notes' });

    expect(slack.posted).toEqual([{ botToken: 'xoxb-A02', form: { channel: 'D0MATHILDE', thread_ts: '1730019600.000100', text: 'You may not message release-notes' } }]);
  });

  it('reacts to a message, a reaction already there no refusal', async () => {
    const messages = createSlackMessages({ apiUrl: slack.apiUrl });
    const reaction = { channel: 'D0MATHILDE', ts: '1730019600.000100', name: 'white_check_mark' };

    await expect(Promise.all([messages.react('xoxb-A02', reaction), messages.react('xoxb-A02', reaction)])).resolves.toEqual([{ isOk: true, value: undefined }, { isOk: true, value: undefined }]);
    expect(slack.reactions).toEqual([{ botToken: 'xoxb-A02', form: { channel: 'D0MATHILDE', timestamp: '1730019600.000100', name: 'white_check_mark' } }]);
  });

  it("posts an item as views.html draws it: its side's colour, heading, title, what it asks with, a button per option naming its fleet message, the pick's filled, then the line under them", async () => {
    const posted = await createSlackMessages({ apiUrl: slack.apiUrl }).post('xoxb-A01', { messageId: 'msg_01m3tbfspe96yf1rnr4ank0002', channel: 'U0MATHILDE', threadTs: null, message: QUESTION_POST });

    expect(posted).toEqual({ isOk: true, value: { channel: 'D0MATHILDE', ts: '1730019600.000001' } });
    const form = slack.posted[0]?.form;
    const attachments: unknown = JSON.parse(form?.attachments ?? 'null');
    expect({ channel: form?.channel, threadTs: form?.thread_ts, text: form?.text, blocks: form?.blocks, attachments }).toEqual({
      channel: 'U0MATHILDE',
      threadTs: undefined,
      text: undefined,
      blocks: undefined,
      attachments: [
        {
          color: '#4a6fa5',
          fallback: 'Question from finance: Cut travel?',
          blocks: [
            { type: 'context', block_id: 'from:finance', elements: [{ type: 'mrkdwn', text: 'Question from finance · Decide' }] },
            { type: 'section', block_id: 'title', text: { type: 'mrkdwn', text: '*Cut travel?*' } },
            { type: 'section', block_id: 'body', text: { type: 'mrkdwn', text: 'Over by 10%' } },
            { type: 'context', block_id: 'aside', elements: [{ type: 'mrkdwn', text: 'finance picks 1: cheaper' }] },
            {
              type: 'actions',
              block_id: 'msg_01m3tbfspe96yf1rnr4ank0002',
              elements: [
                { type: 'button', action_id: 'answer-1', text: { type: 'plain_text', text: '1. Cut' }, value: '1', style: 'primary' },
                { type: 'button', action_id: 'answer-2', text: { type: 'plain_text', text: '2. Keep' }, value: '2' },
              ],
            },
            { type: 'context', block_id: 'footer', elements: [{ type: 'mrkdwn', text: '<https://gateway.acme.test/bridge|Open in Bridge> · reply in the thread to add a note' }] },
          ],
        },
      ],
    });
  });

  it("posts a step's Open on its link and Done, and an alert's Seen, grey, with no line it does not have", async () => {
    const messages = createSlackMessages({ apiUrl: slack.apiUrl });
    await messages.post('xoxb-A01', { messageId: 'msg_01m3tbfspe96yf1rnr4ank0002', channel: 'U0MATHILDE', threadTs: null, message: { text: 'Step from finance: Approve', item: { ...QUESTION_POST.item, aside: null, footer: null }, buttons: [{ text: 'Open github.com', url: 'https://github.com/new' }, { text: 'Done', isDone: true }] } });
    await messages.post('xoxb-A01', { messageId: 'msg_01m3tbfspe96yf1rnr4ank0003', channel: 'U0MATHILDE', threadTs: null, message: { text: 'Alert from watch: Silent', item: { asker: 'watch', heading: 'Alert from watch · Stay aware', title: 'Silent', body: null, aside: null, footer: null, tone: 'aware' }, buttons: [{ text: 'Seen', isSeen: true }] } });

    const [step, alert] = slack.posted.map(({ form }) => z.array(z.object({ color: z.string(), blocks: z.array(z.object({ type: z.string(), elements: z.array(z.unknown()).optional() })) })).parse(JSON.parse(form.attachments ?? '')));
    expect({ step: step?.[0]?.blocks.map(({ type }) => type), stepButtons: step?.[0]?.blocks[3]?.elements, alertColor: alert?.[0]?.color, alert: alert?.[0]?.blocks.map(({ type }) => type), alertButtons: alert?.[0]?.blocks[2]?.elements }).toEqual({
      step: ['context', 'section', 'section', 'actions'],
      stepButtons: [
        { type: 'button', action_id: 'open', text: { type: 'plain_text', text: 'Open github.com' }, url: 'https://github.com/new', value: 'open', style: 'primary' },
        { type: 'button', action_id: 'done', text: { type: 'plain_text', text: 'Done' }, value: 'done' },
      ],
      alertColor: '#dddddd',
      alert: ['context', 'section', 'actions'],
      alertButtons: [{ type: 'button', action_id: 'seen', text: { type: 'plain_text', text: 'Seen' }, value: 'seen' }],
    });
  });

  it('posts a Seen button under a message that is no item, naming its fleet message', async () => {
    await createSlackMessages({ apiUrl: slack.apiUrl }).post('xoxb-A01', { messageId: 'msg_01m3tbfspe96yf1rnr4ank0002', channel: 'U0MATHILDE', threadTs: null, message: { text: 'Release 0.36 is out', item: null, buttons: [{ text: 'Seen', isSeen: true }] } });

    const form = slack.posted[0]?.form;
    const blocks: unknown = JSON.parse(form?.blocks ?? 'null');
    expect({ text: form?.text, blocks }).toEqual({
      text: 'Release 0.36 is out',
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: 'Release 0.36 is out' } },
        { type: 'actions', block_id: 'msg_01m3tbfspe96yf1rnr4ank0002', elements: [{ type: 'button', action_id: 'seen', text: { type: 'plain_text', text: 'Seen' }, value: 'seen' }] },
      ],
    });
  });

  it('posts text alone in a thread', async () => {
    await createSlackMessages({ apiUrl: slack.apiUrl }).post('xoxb-A02', { messageId: 'msg_01m3tbfspe96yf1rnr4ank0003', channel: 'C0LAUNCH', threadTs: '1730019600.000100', message: { text: 'Friday', item: null, buttons: [] } });

    expect(slack.posted[0]?.form).toEqual({ channel: 'C0LAUNCH', thread_ts: '1730019600.000100', text: 'Friday' });
  });

  it("answers rate limited with Slack's Retry-After", async () => {
    slack.rateLimit('chat.postMessage', 7);

    await expect(createSlackMessages({ apiUrl: slack.apiUrl }).post('xoxb-A02', { messageId: 'msg_01m3tbfspe96yf1rnr4ank0003', channel: 'U0MATHILDE', threadTs: null, message: { text: 'Friday', item: null, buttons: [] } })).resolves.toEqual({ isOk: false, error: { kind: 'rateLimited', retryAfterSeconds: 7 } });
  });
});

describe("a bot's post edited once something came of its item (Bridge, view sync)", () => {
  it('reads an item back as Slack holds it, in a conversation: its heading, asker, title, lines, side and buttons', async () => {
    const messages = createSlackMessages({ apiUrl: slack.apiUrl });
    await messages.post('xoxb-A01', { messageId: 'msg_01m3tbfspe96yf1rnr4ank0002', channel: 'D0MATHILDE', threadTs: null, message: QUESTION_POST });

    await expect(messages.messageOf('xoxb-A01', { channel: 'D0MATHILDE', ts: '1730019600.000001', threadTs: null })).resolves.toEqual({ isOk: true, value: QUESTION_POST });
  });

  it("reads a message that is no item back as its text, in a thread", async () => {
    const messages = createSlackMessages({ apiUrl: slack.apiUrl });
    await messages.post('xoxb-A01', { messageId: 'msg_01m3tbfspe96yf1rnr4ank0002', channel: 'D0MATHILDE', threadTs: '1730019000.000100', message: { text: 'Friday', item: null, buttons: [] } });

    await expect(messages.messageOf('xoxb-A01', { channel: 'D0MATHILDE', ts: '1730019600.000001', threadTs: '1730019000.000100' })).resolves.toEqual({ isOk: true, value: { text: 'Friday', item: null, buttons: [] } });
  });

  it('answers refused for a message Slack does not have', async () => {
    await expect(createSlackMessages({ apiUrl: slack.apiUrl }).messageOf('xoxb-A01', { channel: 'D0MATHILDE', ts: '1730019600.000009', threadTs: null })).resolves.toEqual({ isOk: false, error: { kind: 'refused', error: 'message_not_found' } });
  });

  it('gives an item its edited lines and side, its buttons gone', async () => {
    const messages = createSlackMessages({ apiUrl: slack.apiUrl });
    await messages.post('xoxb-A01', { messageId: 'msg_01m3tbfspe96yf1rnr4ank0002', channel: 'D0MATHILDE', threadTs: null, message: QUESTION_POST });
    const answered = { text: QUESTION_POST.text, item: { ...QUESTION_POST.item, body: '✅ You answered: *2. Keep*', aside: null, tone: 'done' as const }, buttons: [] };

    const updated = await messages.update('xoxb-A01', { channel: 'D0MATHILDE', ts: '1730019600.000001', message: answered });

    const form = slack.updated[0]?.form;
    expect({ updated, blocks: form?.blocks, read: await messages.messageOf('xoxb-A01', { channel: 'D0MATHILDE', ts: '1730019600.000001', threadTs: null }) }).toEqual({ updated: { isOk: true, value: undefined }, blocks: '[]', read: { isOk: true, value: answered } });
  });

  it('gives a message that is no item new text, its buttons gone', async () => {
    const messages = createSlackMessages({ apiUrl: slack.apiUrl });
    await messages.post('xoxb-A01', { messageId: 'msg_01m3tbfspe96yf1rnr4ank0002', channel: 'D0MATHILDE', threadTs: null, message: { text: 'Friday', item: null, buttons: [{ text: 'Seen', isSeen: true }] } });

    const updated = await messages.update('xoxb-A01', { channel: 'D0MATHILDE', ts: '1730019600.000001', message: { text: 'Friday\n\n_Seen in Bridge_', item: null, buttons: [] } });

    expect({ updated, form: slack.updated[0]?.form }).toEqual({ updated: { isOk: true, value: undefined }, form: { channel: 'D0MATHILDE', ts: '1730019600.000001', text: 'Friday\n\n_Seen in Bridge_', blocks: '[]', attachments: '[]' } });
  });
});
