import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startFakeSlack, type FakeSlack } from '../../../test/support/fake-slack.js';
import { createSlackMessages } from './slack-messages.js';

// A bot's message only one person sees (chat.postEphemeral), against the
// Slack double: the text, and a button that opens an address.

let slack: FakeSlack;

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

  it('posts in a conversation, with a button per option under a question naming its fleet message, answering the Slack message it is', async () => {
    const posted = await createSlackMessages({ apiUrl: slack.apiUrl }).post('xoxb-A01', { messageId: 'msg_01m3tbfspe96yf1rnr4ank0002', channel: 'U0MATHILDE', threadTs: null, text: '*Cut travel?*\nOver by 10%', buttons: [{ text: 'Cut', option: 1 }, { text: 'Keep', option: 2 }] });

    expect(posted).toEqual({ isOk: true, value: { channel: 'U0MATHILDE', ts: '1730019600.000001' } });
    const form = slack.posted[0]?.form;
    const blocks: unknown = JSON.parse(form?.blocks ?? 'null');
    expect({ channel: form?.channel, threadTs: form?.thread_ts, text: form?.text, blocks }).toEqual({
      channel: 'U0MATHILDE',
      threadTs: undefined,
      text: '*Cut travel?*\nOver by 10%',
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: '*Cut travel?*\nOver by 10%' } },
        { type: 'actions', block_id: 'msg_01m3tbfspe96yf1rnr4ank0002', elements: [{ type: 'button', action_id: 'answer-1', text: { type: 'plain_text', text: 'Cut' }, value: '1' }, { type: 'button', action_id: 'answer-2', text: { type: 'plain_text', text: 'Keep' }, value: '2' }] },
      ],
    });
  });

  it('posts text alone in a thread', async () => {
    await createSlackMessages({ apiUrl: slack.apiUrl }).post('xoxb-A02', { messageId: 'msg_01m3tbfspe96yf1rnr4ank0003', channel: 'C0LAUNCH', threadTs: '1730019600.000100', text: 'Friday', buttons: [] });

    expect(slack.posted[0]?.form).toEqual({ channel: 'C0LAUNCH', thread_ts: '1730019600.000100', text: 'Friday' });
  });

  it("answers rate limited with Slack's Retry-After", async () => {
    slack.rateLimit('chat.postMessage', 7);

    await expect(createSlackMessages({ apiUrl: slack.apiUrl }).post('xoxb-A02', { messageId: 'msg_01m3tbfspe96yf1rnr4ank0003', channel: 'U0MATHILDE', threadTs: null, text: 'Friday', buttons: [] })).resolves.toEqual({ isOk: false, error: { kind: 'rateLimited', retryAfterSeconds: 7 } });
  });
});
