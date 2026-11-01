import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { memoryItemOutcomes } from '../../../test/support/people-fakes.js';
import { aSlackApp, fakeSlackMessages, memorySlackApps, memorySlackPosts } from '../../../test/support/slack-fakes.js';
import { createEditSlackPosts } from './edit-slack-posts.js';

// View sync (Bridge, section 7): after the person's action in any place, a
// post of that item in Slack is edited to show what was done and where, its
// buttons gone.

const AT = new Date('2026-10-31T19:58:00.000Z');
const MATHILDE_SHIP: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9m4t';
const QUESTION_DELIVERY = 'dlv_01m3tbfspe96yf1rnr4ank0002';
const QUESTION_MESSAGE = 'msg_01m3tbfspe96yf1rnr4ank0002';
const QUESTION_TEXT = '*Which design do we build?*\nThree options, see the PR';

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
  const posted = await slack.messages.post('xoxb-1', { messageId: QUESTION_MESSAGE, channel: 'D0MATHILDE', threadTs: null, text: QUESTION_TEXT, buttons: [{ text: 'A', option: 1 }, { text: 'B', option: 2 }] });
  const ts = posted.isOk ? posted.value.ts : null;
  await posts.save({ fleetId: FLEET_ID, personShipId: MATHILDE_SHIP, messageId: QUESTION_MESSAGE, deliveryId: QUESTION_DELIVERY, senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9qrc', appId: 'A01', channel: 'D0MATHILDE', ts, threadTs: null });
  editSlackPosts = createEditSlackPosts({ posts, apps, slack: slack.messages });
});

function answeredInBridge() {
  return outcomes.save({ fleetId: FLEET_ID, shipId: MATHILDE_SHIP, deliveryId: QUESTION_DELIVERY, place: 'bridge', kind: 'answered', option: 2, at: AT });
}

describe('a post in Slack once something came of its item in any place', () => {
  it('is edited to say what was done and where, keeping its text, its buttons gone', async () => {
    await answeredInBridge();

    await editSlackPosts();

    expect(slack.state.edits).toEqual([{ botToken: 'xoxb-1', channel: 'D0MATHILDE', ts: '1730020000.000001', text: `${QUESTION_TEXT}\n\n_Answered in Bridge: option 2_` }]);
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

    expect(slack.state.edits.map(({ text }) => text)).toEqual([`${QUESTION_TEXT}\n\n_Seen in Slack_`]);
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
    await slack.messages.update('xoxb-1', { channel: 'D0MATHILDE', ts: '1730020000.000001', text: `${QUESTION_TEXT}\n\n_Answered in Bridge: option 2_` });

    await editSlackPosts();

    expect(slack.state.edits.at(-1)?.text).toBe(`${QUESTION_TEXT}\n\n_Answered in Bridge: option 2_`);
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
