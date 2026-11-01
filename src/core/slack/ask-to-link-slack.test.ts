import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, memoryConnectionStore, SHIP_ID } from '../../../test/support/fleet-fakes.js';
import { fakeCallSender, MESSAGE_ID } from '../../../test/support/mcp-in-fakes.js';
import { memorySlackLinkSteps } from '../../../test/support/slack-fakes.js';
import { createAskToLinkSlack } from './ask-to-link-slack.js';

// A person who opens Bridge's settings with the fleet's workspace connected
// and no link is asked to link Slack by a step from the gateway's ship
// (Bridge, CC14, BG7), once until a link completes.

const MATHILDE_SHIP = 'shp_01m3tbfspe96yf1rnr4ank9m4t';

let sender: ReturnType<typeof fakeCallSender>;
let steps: ReturnType<typeof memorySlackLinkSteps>;
let ask: ReturnType<typeof createAskToLinkSlack>;
let issued: number;

beforeEach(async () => {
  sender = fakeCallSender();
  steps = memorySlackLinkSteps();
  issued = 0;
  const connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: new Date('2026-10-25T09:00:00.000Z') });
  ask = createAskToLinkSlack({
    steps,
    connections,
    sender,
    newStepId: () => {
      issued += 1;
      return `0b7e4c52-1f3a-4d6e-8b2c-5a9d1e7f3c2${String(issued)}`;
    },
    linkUrlOf: (fleetId) => `https://gateway.example.com/slack/link?fleet=${fleetId}`,
  });
});

const askMathilde = () => ask({ fleetId: FLEET_ID, personShipId: MATHILDE_SHIP, workspaceName: 'Acme' });

describe('a person with no Slack link is asked to link Slack by a step', () => {
  it("sends their person ship a step from the gateway's ship, with Link Slack as its link", async () => {
    await askMathilde();

    expect(sender.sent).toEqual([
      {
        crewToken: 'aeolus_ct_v1_gateway',
        to: MATHILDE_SHIP,
        contentType: 'application/vnd.aeolus.step+json',
        payload: JSON.stringify({
          id: '0b7e4c52-1f3a-4d6e-8b2c-5a9d1e7f3c21',
          title: 'Link Slack',
          why: "This fleet is connected to Slack in Acme, and your Slack account is not linked. Once linked, you talk to the fleet's bots in Slack as yourself.",
          link: `https://gateway.example.com/slack/link?fleet=${FLEET_ID}`,
        }),
        idempotencyKey: 'slack-link:0b7e4c52-1f3a-4d6e-8b2c-5a9d1e7f3c21',
      },
    ]);
  });

  it('keeps the message of the step it sent, so the link finishes that step', async () => {
    await askMathilde();

    expect(steps.held.map(({ stepMessageId }) => stepMessageId)).toEqual([MESSAGE_ID]);
  });

  it('sends no second step while they have not linked', async () => {
    await askMathilde();

    await askMathilde();

    expect(sender.sent).toHaveLength(1);
  });

  it('asks again after a link in between', async () => {
    await askMathilde();
    await steps.close(FLEET_ID, MATHILDE_SHIP);

    await askMathilde();

    expect(sender.sent.map(({ idempotencyKey }) => idempotencyKey)).toEqual(['slack-link:0b7e4c52-1f3a-4d6e-8b2c-5a9d1e7f3c21', 'slack-link:0b7e4c52-1f3a-4d6e-8b2c-5a9d1e7f3c22']);
  });

  it('asks at the next read when the fleet did not answer, under the same key, so it is stored once', async () => {
    sender.state.refusal = { code: 'UNAVAILABLE', message: 'The fleet did not answer' };
    await askMathilde();
    sender.state.refusal = undefined;

    await askMathilde();
    await askMathilde();

    expect(sender.sent.map(({ idempotencyKey }) => idempotencyKey)).toEqual(['slack-link:0b7e4c52-1f3a-4d6e-8b2c-5a9d1e7f3c21']);
  });

  it('tries no more once the fleet refused the step', async () => {
    sender.state.refusal = { code: 'FORBIDDEN', message: "mathilde is outside the gateway's reach" };
    await askMathilde();
    sender.state.refusal = undefined;

    await askMathilde();

    expect(sender.sent).toEqual([]);
    expect(steps.held.map(({ isTold, stepMessageId }) => ({ isTold, stepMessageId }))).toEqual([{ isTold: true, stepMessageId: null }]);
  });

  it('asks nothing while the gateway is not connected to the fleet', async () => {
    const unconnected = createAskToLinkSlack({ steps, connections: memoryConnectionStore(), sender, newStepId: () => 'unused', linkUrlOf: () => 'https://gateway.example.com/slack/link' });

    await unconnected({ fleetId: FLEET_ID, personShipId: MATHILDE_SHIP, workspaceName: 'Acme' });

    expect(sender.sent).toEqual([]);
  });
});
