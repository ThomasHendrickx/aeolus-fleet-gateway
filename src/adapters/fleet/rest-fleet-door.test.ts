import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRestFleetDoor } from './rest-fleet-door.js';

const PERSON_SHIP = 'shp_01m3tb1zgr5h2ffee12xnch8pp';

let server: Server;
let base: string;
let received: { url: string | undefined; headers: IncomingHttpHeaders; body: string }[];
let answer: { status: number; body: unknown };

beforeEach(async () => {
  received = [];
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received.push({ url: request.url, headers: request.headers, body: Buffer.concat(chunks).toString('utf8') });
      response.writeHead(answer.status, { 'content-type': 'application/json' }).end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const CALL = { crewToken: 'aeolus_ct_v1_gateway', accountToken: 'account-token-1', shipId: PERSON_SHIP } as const;

function parsed(body: string): unknown {
  return JSON.parse(body);
}

/** The parts of a received call that say who made it and what. */
function sent() {
  return received.map(({ url, headers, body }) => ({ url, authorization: headers.authorization, accountToken: headers['aeolus-account-token'], body: parsed(body) }));
}

describe("the fleet's calls the gateway makes for a signed-in account (decision 0057)", () => {
  it("gets a ship's starting prompt with the account's token beside the gateway's crew token, answering its secret", async () => {
    answer = { status: 200, body: { shipId: PERSON_SHIP, prompt: 'p', crewLines: [], secret: 'aeolus_sk_v1_secret' } };

    await expect(createRestFleetDoor(base).startingPrompt(CALL)).resolves.toEqual({ isOk: true, value: { secret: 'aeolus_sk_v1_secret' } });
    expect(sent()).toEqual([{ url: '/api/v1/fleet/getStartingPrompt', authorization: 'Bearer aeolus_ct_v1_gateway', accountToken: 'account-token-1', body: { shipId: PERSON_SHIP } }]);
  });

  it('releases a ship with the account token beside the crew token', async () => {
    answer = { status: 200, body: {} };

    await expect(createRestFleetDoor(base).release(CALL)).resolves.toEqual({ isOk: true, value: undefined });
    expect(sent()).toEqual([{ url: '/api/v1/fleet/release', authorization: 'Bearer aeolus_ct_v1_gateway', accountToken: 'account-token-1', body: { shipId: PERSON_SHIP } }]);
  });

  it("answers the fleet's refusal", async () => {
    answer = { status: 409, body: { code: 'CONFLICT', message: 'person-charlotte is crewed' } };

    await expect(createRestFleetDoor(base).startingPrompt(CALL)).resolves.toEqual({ isOk: false, error: { code: 'CONFLICT', message: 'person-charlotte is crewed' } });
  });
});

describe("the calls the gateway makes as the crew of a person's ship (Q20)", () => {
  const QUESTION = { id: '9b2f6c1e-4a7d-4e0b-8c3f-2d5a6b7c8d9e', title: 'Go for release 1.4?', context: 'All checks are green.', options: [{ key: 1, label: 'Go' }], pick: { option: 1, why: 'Every check is green' } };

  it('asks how many deliveries wait, without waiting', async () => {
    answer = { status: 200, body: { waiting: 2, forced: 0 } };

    await expect(createRestFleetDoor(base).person.inbox('aeolus_ct_v1_charlotte')).resolves.toMatchObject({ isOk: true, value: { waiting: 2 } });
    expect(sent()).toEqual([{ url: '/api/v1/ship/inbox', authorization: 'Bearer aeolus_ct_v1_charlotte', accountToken: undefined, body: { waitSeconds: 0 } }]);
  });

  it("reads the person ship's own name, as the fleet's whoami answers it", async () => {
    answer = { status: 200, body: { shipId: 'shp_01m3tbfspe96yf1rnr4ank0per', fleetId: 'flt_01m3tbfspe96yf1rnr4ank0flt', name: 'charlotte', type: 'person' } };

    await expect(createRestFleetDoor(base).person.whoami('aeolus_ct_v1_charlotte')).resolves.toEqual({ isOk: true, value: { name: 'charlotte' } });
    expect(received.map(({ url, headers }) => ({ url, authorization: headers.authorization }))).toEqual([{ url: '/api/v1/ship/whoami', authorization: 'Bearer aeolus_ct_v1_charlotte' }]);
  });

  it('waits while the count is the one the crew knows, up to the fleet\'s longest wait, or less when told, in whole seconds', async () => {
    answer = { status: 200, body: { waiting: 3, forced: 0 } };
    const door = createRestFleetDoor(base).person;
    const signal = new AbortController().signal;

    await door.inbox('aeolus_ct_v1_charlotte', { knownWaiting: 2, signal });
    await door.inbox('aeolus_ct_v1_charlotte', { knownWaiting: 2, signal, atMostMs: 4_200 });
    await door.inbox('aeolus_ct_v1_charlotte', { knownWaiting: 2, signal, atMostMs: 600_000 });

    expect(sent().map(({ body }) => body)).toEqual([
      { waitSeconds: 25, knownWaiting: 2 },
      { waitSeconds: 5, knownWaiting: 2 },
      { waitSeconds: 25, knownWaiting: 2 },
    ]);
  });

  it("takes the waiting deliveries, reading a question's title from its payload", async () => {
    const delivery = {
      deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001',
      messageId: 'msg_01m3tbfspe96yf1rnr4ank0001',
      senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9trk',
      senderName: 'tracker',
      senderType: 'tracker',
      senderStatus: 'crewed',
      recipient: { kind: 'ship', shipId: 'shp_01m3tbfspe96yf1rnr4ank0per' },
      model: null,
      sentAt: '2026-10-19T08:00:00.000Z',
      inReplyTo: null,
      attempts: 0,
      isForced: false,
      meetingId: null,
      scheduleId: null,
      sendTime: null,
      state: 'received',
      handOverNumber: null,
    };
    answer = {
      status: 200,
      body: {
        deliveries: [
          { ...delivery, contentType: 'application/vnd.aeolus.question+json', payload: JSON.stringify(QUESTION) },
          { ...delivery, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', contentType: 'text/plain', payload: 'The build is red' },
        ],
      },
    };

    const taken = await createRestFleetDoor(base).person.pushReceive('aeolus_ct_v1_charlotte', { max: 10 });

    expect(taken.isOk ? taken.value.map(({ headline, sentAt }) => ({ headline, sentAt })) : taken).toEqual([
      { headline: 'Go for release 1.4?', sentAt: new Date('2026-10-19T08:00:00.000Z') },
      { headline: null, sentAt: new Date('2026-10-19T08:00:00.000Z') },
    ]);
    expect(sent().map(({ url, body }) => ({ url, body }))).toEqual([{ url: '/api/v1/ship/pushReceive', body: { max: 10, waker: 'gateway' } }]);
  });

  it("reads the question a question asks, and the one a withdrawal or a replacement names, a replacement headed by its new question (Bridge, CC11)", async () => {
    const delivery = {
      deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001',
      messageId: 'msg_01m3tbfspe96yf1rnr4ank0001',
      senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9trk',
      senderName: 'orchestrator-1',
      senderType: 'orchestrator',
      senderStatus: 'crewed',
      recipient: { kind: 'ship', shipId: 'shp_01m3tbfspe96yf1rnr4ank0per' },
      model: null,
      sentAt: '2026-10-31T19:41:00.000Z',
      inReplyTo: null,
      attempts: 0,
      isForced: false,
      meetingId: null,
      scheduleId: null,
      sendTime: null,
      state: 'received',
      handOverNumber: null,
    };
    const replacing = { ...QUESTION, id: '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f', title: 'Go for release 1.4 after #1488?' };
    answer = {
      status: 200,
      body: {
        deliveries: [
          { ...delivery, contentType: 'application/vnd.aeolus.question+json', payload: JSON.stringify(QUESTION) },
          { ...delivery, contentType: 'application/vnd.aeolus.question-withdrawal+json', payload: JSON.stringify({ questionId: QUESTION.id }) },
          { ...delivery, contentType: 'application/vnd.aeolus.question-replacement+json', payload: JSON.stringify({ questionId: QUESTION.id, question: replacing }) },
          { ...delivery, contentType: 'application/vnd.aeolus.question-withdrawal+json', payload: '{"questionId":"not a uuid"}' },
          { ...delivery, contentType: 'text/plain', payload: 'The build is red' },
        ],
      },
    };

    const taken = await createRestFleetDoor(base).person.pushReceive('aeolus_ct_v1_charlotte', { max: 10 });

    expect(taken.isOk ? taken.value.map(({ headline, askedQuestionId, withdrawnQuestionId }) => ({ headline, askedQuestionId, withdrawnQuestionId })) : taken).toEqual([
      { headline: 'Go for release 1.4?', askedQuestionId: QUESTION.id, withdrawnQuestionId: null },
      { headline: null, askedQuestionId: null, withdrawnQuestionId: QUESTION.id },
      { headline: 'Go for release 1.4 after #1488?', askedQuestionId: replacing.id, withdrawnQuestionId: QUESTION.id },
      { headline: null, askedQuestionId: null, withdrawnQuestionId: null },
      { headline: null, askedQuestionId: null, withdrawnQuestionId: null },
    ]);
  });

  it("reads the step a step asks, and the one a step withdrawal or replacement names, a replacement headed by its new step (Bridge, CC14)", async () => {
    const delivery = {
      deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001',
      messageId: 'msg_01m3tbfspe96yf1rnr4ank0001',
      senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9trk',
      senderName: 'builder-plugin',
      senderType: 'builder',
      senderStatus: 'crewed',
      recipient: { kind: 'ship', shipId: 'shp_01m3tbfspe96yf1rnr4ank0per' },
      model: null,
      sentAt: '2026-10-31T19:41:00.000Z',
      inReplyTo: null,
      attempts: 0,
      isForced: false,
      meetingId: null,
      scheduleId: null,
      sendTime: null,
      state: 'received',
      handOverNumber: null,
    };
    const step = { id: '6f1c2a40-5d1b-4b8e-9a51-0c8e3f2a7d10', title: 'Create the GitHub repository aeolus-fleet-memory-plugin', why: 'The plugin needs a home' };
    const replacing = { id: '7a2d3b51-6e2c-4c9f-8b62-1d9f4a3b8e21', title: 'Create the GitHub repository aeolus-fleet-memory', why: 'The plugin was renamed' };
    answer = {
      status: 200,
      body: {
        deliveries: [
          { ...delivery, contentType: 'application/vnd.aeolus.step+json', payload: JSON.stringify(step) },
          { ...delivery, contentType: 'application/vnd.aeolus.step-withdrawal+json', payload: JSON.stringify({ stepId: step.id }) },
          { ...delivery, contentType: 'application/vnd.aeolus.step-replacement+json', payload: JSON.stringify({ stepId: step.id, step: replacing }) },
          { ...delivery, contentType: 'application/vnd.aeolus.step-withdrawal+json', payload: '{"stepId":"not a uuid"}' },
          { ...delivery, contentType: 'application/vnd.aeolus.question-withdrawal+json', payload: JSON.stringify({ questionId: step.id }) },
        ],
      },
    };

    const taken = await createRestFleetDoor(base).person.pushReceive('aeolus_ct_v1_charlotte', { max: 10 });

    expect(taken.isOk ? taken.value.map(({ headline, stepId, withdrawnStepId }) => ({ headline, stepId, withdrawnStepId })) : taken).toEqual([
      { headline: step.title, stepId: step.id, withdrawnStepId: null },
      { headline: null, stepId: null, withdrawnStepId: step.id },
      { headline: replacing.title, stepId: replacing.id, withdrawnStepId: step.id },
      { headline: null, stepId: null, withdrawnStepId: null },
      { headline: null, stepId: null, withdrawnStepId: null },
    ]);
  });

  it("reads the uuid of the step a step asks, and none of a step whose payload does not read or of any other message (Bridge, CC14)", async () => {
    const delivery = {
      deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001',
      messageId: 'msg_01m3tbfspe96yf1rnr4ank0001',
      senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9trk',
      senderName: 'builder-plugin',
      senderType: 'builder',
      senderStatus: 'crewed',
      recipient: { kind: 'ship', shipId: 'shp_01m3tbfspe96yf1rnr4ank0per' },
      model: null,
      sentAt: '2026-10-31T19:41:00.000Z',
      inReplyTo: null,
      attempts: 0,
      isForced: false,
      meetingId: null,
      scheduleId: null,
      sendTime: null,
      state: 'received',
      handOverNumber: null,
    };
    const step = { id: '6f1c2a40-5d1b-4b8e-9a51-0c8e3f2a7d10', title: 'Create the GitHub repository aeolus-fleet-memory-plugin', why: 'The plugin needs its own repository.', link: 'https://github.com/new' };
    answer = {
      status: 200,
      body: {
        deliveries: [
          { ...delivery, contentType: 'application/vnd.aeolus.step+json', payload: JSON.stringify(step) },
          { ...delivery, contentType: 'application/vnd.aeolus.step+json', payload: JSON.stringify({ ...step, id: 'not a uuid' }) },
          { ...delivery, contentType: 'text/plain', payload: JSON.stringify(step) },
        ],
      },
    };

    const taken = await createRestFleetDoor(base).person.pushReceive('aeolus_ct_v1_charlotte', { max: 10 });

    expect(taken.isOk ? taken.value.map(({ stepId }) => stepId) : taken).toEqual(['6f1c2a40-5d1b-4b8e-9a51-0c8e3f2a7d10', null, null]);
  });

  it("reads the asker's pick on a question and a replacement's new one, and the link of a step and a step replacement's new one, none of any other message or a link that is not http or https (aeolus-fleet#1535)", async () => {
    const delivery = {
      deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001',
      messageId: 'msg_01m3tbfspe96yf1rnr4ank0001',
      senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9trk',
      senderName: 'orchestrator-1',
      senderType: 'orchestrator',
      senderStatus: 'crewed',
      recipient: { kind: 'ship', shipId: 'shp_01m3tbfspe96yf1rnr4ank0per' },
      model: null,
      sentAt: '2026-10-31T19:41:00.000Z',
      inReplyTo: null,
      attempts: 0,
      isForced: false,
      meetingId: null,
      scheduleId: null,
      sendTime: null,
      state: 'received',
      handOverNumber: null,
    };
    const twoOptions = { ...QUESTION, options: [{ key: 1, label: 'Go' }, { key: 2, label: 'Wait' }], pick: { option: 2, why: 'One check is flaky' } };
    const step = { id: '6f1c2a40-5d1b-4b8e-9a51-0c8e3f2a7d10', title: 'Create the GitHub repository aeolus-fleet-memory-plugin', why: '', link: 'https://github.com/new' };
    answer = {
      status: 200,
      body: {
        deliveries: [
          { ...delivery, contentType: 'application/vnd.aeolus.question+json', payload: JSON.stringify(twoOptions) },
          { ...delivery, contentType: 'application/vnd.aeolus.question-replacement+json', payload: JSON.stringify({ questionId: QUESTION.id, question: { ...twoOptions, id: '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f' } }) },
          { ...delivery, contentType: 'application/vnd.aeolus.step+json', payload: JSON.stringify(step) },
          { ...delivery, contentType: 'application/vnd.aeolus.step+json', payload: JSON.stringify({ ...step, link: 'javascript:alert(1)' }) },
          { ...delivery, contentType: 'application/vnd.aeolus.step-replacement+json', payload: JSON.stringify({ stepId: step.id, step: { ...step, id: '7a2d3b51-6e2c-4c9f-8b62-1d9f4a3b8e21', link: 'https://github.com/organizations/new' } }) },
          { ...delivery, contentType: 'text/plain', payload: JSON.stringify(step) },
        ],
      },
    };

    const taken = await createRestFleetDoor(base).person.pushReceive('aeolus_ct_v1_charlotte', { max: 10 });

    expect(taken.isOk ? taken.value.map(({ pick, stepLink }) => ({ pick, stepLink })) : taken).toEqual([
      { pick: 2, stepLink: null },
      { pick: 2, stepLink: null },
      { pick: null, stepLink: 'https://github.com/new' },
      { pick: null, stepLink: null },
      { pick: null, stepLink: 'https://github.com/organizations/new' },
      { pick: null, stepLink: null },
    ]);
  });

  it("reads the headline of a step, an alert and a notice from its payload, and none from one it cannot read (Bridge, CC14, CC15)", async () => {
    const delivery = {
      deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001',
      messageId: 'msg_01m3tbfspe96yf1rnr4ank0001',
      senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9trk',
      senderName: 'watch',
      senderType: 'watch',
      senderStatus: 'crewed',
      recipient: { kind: 'ship', shipId: 'shp_01m3tbfspe96yf1rnr4ank0per' },
      model: null,
      sentAt: '2026-10-31T19:47:00.000Z',
      inReplyTo: null,
      attempts: 0,
      isForced: false,
      meetingId: null,
      scheduleId: null,
      sendTime: null,
      state: 'received',
      handOverNumber: null,
    };
    const step = { id: '6f1c2a40-5d1b-4b8e-9a51-0c8e3f2a7d10', title: 'Create the GitHub repository aeolus-fleet-memory-plugin', why: 'The plugin needs its own repository.' };
    const alert = {
      alertId: 'alr_01m3tbfspe96yf1rnr4ank0alr',
      headline: 'builder-gateway: no report change for 2 h',
      body: 'Its last report, 17:46.',
      ship: { id: 'shp_01m3tbfspe96yf1rnr4ank9bgw', name: 'builder-gateway' },
      fleetId: 'flt_01m3tbfspe96yf1rnr4ank0flt',
      toldAs: 'owner',
      since: '2026-10-31T17:46:00.000Z',
      raisedAt: '2026-10-31T19:46:00.000Z',
      signal: 'report-unchanged',
      facts: { reportedAt: '2026-10-31T17:46:00.000Z', expectedWithinMinutes: 45 },
    };
    const notice = { headline: 'PR #1497 opened: Bridge mockups', body: 'Ready for review.' };
    answer = {
      status: 200,
      body: {
        deliveries: [
          { ...delivery, contentType: 'application/vnd.aeolus.step+json', payload: JSON.stringify(step) },
          { ...delivery, contentType: 'application/vnd.aeolus.alert+json', payload: JSON.stringify(alert) },
          { ...delivery, contentType: 'application/vnd.aeolus.notice+json', payload: JSON.stringify(notice) },
          { ...delivery, contentType: 'application/vnd.aeolus.notice+json', payload: '{"body":"no headline"}' },
        ],
      },
    };

    const taken = await createRestFleetDoor(base).person.pushReceive('aeolus_ct_v1_charlotte', { max: 10 });

    expect(taken.isOk ? taken.value.map(({ headline }) => headline) : taken).toEqual([
      'Create the GitHub repository aeolus-fleet-memory-plugin',
      'builder-gateway: no report change for 2 h',
      'PR #1497 opened: Bridge mockups',
      null,
    ]);
  });

  it("reads a page of the person ship's record after a cursor, each delivery with its state (Bridge, CC12)", async () => {
    const entry = {
      deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002',
      messageId: 'msg_01m3tbfspe96yf1rnr4ank0002',
      senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9trk',
      senderName: 'tracker',
      senderType: 'tracker',
      senderStatus: 'crewed',
      recipient: { kind: 'ship', shipId: 'shp_01m3tbfspe96yf1rnr4ank0per' },
      model: null,
      contentType: 'text/plain',
      payload: 'The build is red',
      sentAt: '2026-10-19T08:00:00.000Z',
      inReplyTo: null,
      attempts: 1,
      isForced: false,
      meetingId: null,
      scheduleId: null,
      sendTime: null,
      state: 'handled',
      isPayloadUnreadable: false,
    };
    answer = { status: 200, body: { items: [entry, { ...entry, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001', state: 'acknowledged', payload: '', isPayloadUnreadable: true }], nextCursor: 'dlv_01m3tbfspe96yf1rnr4ank0001' } };

    const page = await createRestFleetDoor(base).person.record('aeolus_ct_v1_charlotte', { cursor: 'dlv_01m3tbfspe96yf1rnr4ank0003', limit: 20 });

    expect(page.isOk ? { items: page.value.items.map(({ deliveryId, state, isPayloadUnreadable, headline }) => ({ deliveryId, state, isPayloadUnreadable, headline })), nextCursor: page.value.nextCursor } : page).toEqual({
      items: [
        { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', state: 'handled', isPayloadUnreadable: false, headline: null },
        { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001', state: 'acknowledged', isPayloadUnreadable: true, headline: null },
      ],
      nextCursor: 'dlv_01m3tbfspe96yf1rnr4ank0001',
    });
    expect(sent().map(({ url, body }) => ({ url, body }))).toEqual([{ url: '/api/v1/ship/record', body: { cursor: 'dlv_01m3tbfspe96yf1rnr4ank0003', limit: 20 } }]);
  });

  it('reads the newest page of the record when no cursor is given', async () => {
    answer = { status: 200, body: { items: [], nextCursor: null } };

    await createRestFleetDoor(base).person.record('aeolus_ct_v1_charlotte', { cursor: null, limit: 20 });

    expect(sent().map(({ body }) => body)).toEqual([{ limit: 20 }]);
  });

  describe('the exchange calls (aeolus-fleet exchange-read, core main)', () => {
    const OTHER = 'shp_01m3tbfspe96yf1rnr4ank9trk';
    const entry = { messageId: 'msg_01m3tbfspe96yf1rnr4ank0002', senderShipId: PERSON_SHIP, payload: 'On it', isPayloadUnreadable: false, contentType: 'text/plain', inReplyTo: 'msg_01m3tbfspe96yf1rnr4ank0001', sentAt: '2026-11-06T10:00:00.000Z', deliveryState: 'acknowledged', receivedDelivery: null };

    it.each([
      [{ kind: 'newest' as const }, { otherShipId: OTHER, limit: 20 }],
      [{ kind: 'before' as const, cursor: 'dlv_01m3tbfspe96yf1rnr4ank0005' as const }, { otherShipId: OTHER, limit: 20, before: 'dlv_01m3tbfspe96yf1rnr4ank0005' }],
      [{ kind: 'after' as const, cursor: 'dlv_01m3tbfspe96yf1rnr4ank0005' as const }, { otherShipId: OTHER, limit: 20, after: 'dlv_01m3tbfspe96yf1rnr4ank0005' }],
      [{ kind: 'around' as const, messageId: 'msg_01m3tbfspe96yf1rnr4ank0002' as const }, { otherShipId: OTHER, limit: 20, around: 'msg_01m3tbfspe96yf1rnr4ank0002' }],
    ])('asks for a page of an exchange starting %j with the ship id as the body', async (start, body) => {
      answer = { status: 200, body: { items: [entry], olderCursor: 'dlv_01m3tbfspe96yf1rnr4ank0002', newerCursor: null, prunedUpTo: null } };

      const page = await createRestFleetDoor(base).person.exchange('aeolus_ct_v1_charlotte', { otherShipId: OTHER, start, limit: 20 });

      expect(page).toEqual({ isOk: true, value: { items: [entry], olderCursor: 'dlv_01m3tbfspe96yf1rnr4ank0002', newerCursor: null } });
      expect(sent().map(({ url, authorization, body: sentBody }) => ({ url, authorization, body: sentBody }))).toEqual([{ url: '/api/v1/ship/exchange', authorization: 'Bearer aeolus_ct_v1_charlotte', body }]);
    });

    it.each([
      { kind: 'newest' as const },
      { kind: 'before' as const, cursor: 'dlv_01m3tbfspe96yf1rnr4ank0001' as const },
      { kind: 'after' as const, cursor: 'dlv_01m3tbfspe96yf1rnr4ank0001' as const },
      { kind: 'around' as const, messageId: 'msg_01m3tbfspe96yf1rnr4ank0002' as const },
    ])('carries the core pruned edge on every page, including an empty page past it: %j', async (start) => {
      const prunedUpTo = '2026-10-08T12:00:00.000Z';
      const items = start.kind === 'before' ? [] : [entry];
      answer = { status: 200, body: { items, olderCursor: null, newerCursor: null, prunedUpTo } };

      await expect(createRestFleetDoor(base).person.exchange('aeolus_ct_v1_charlotte', { otherShipId: OTHER, start, limit: 20 })).resolves.toEqual({ isOk: true, value: { items, olderCursor: null, newerCursor: null, prunedUpTo } });
    });

    it('omits the pruned edge when core reports none', async () => {
      answer = { status: 200, body: { items: [entry], olderCursor: null, newerCursor: null, prunedUpTo: null } };

      await expect(createRestFleetDoor(base).person.exchange('aeolus_ct_v1_charlotte', { otherShipId: OTHER, start: { kind: 'newest' }, limit: 20 })).resolves.toEqual({ isOk: true, value: { items: [entry], olderCursor: null, newerCursor: null } });
    });

    it('carries the reader\'s own delivery of a message it received, and null on its own message', async () => {
      const received = { ...entry, senderShipId: OTHER, deliveryState: null, receivedDelivery: { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0003', state: 'handed' } };
      const own = { ...entry, receivedDelivery: null };
      answer = { status: 200, body: { items: [received, own], olderCursor: null, newerCursor: null, prunedUpTo: null } };

      const page = await createRestFleetDoor(base).person.exchange('aeolus_ct_v1_charlotte', { otherShipId: OTHER, start: { kind: 'newest' }, limit: 20 });

      expect(page).toEqual({ isOk: true, value: { items: [received, own], olderCursor: null, newerCursor: null } });
    });

    it('answers the fleet\'s refusal of an exchange read', async () => {
      answer = { status: 404, body: { code: 'NOT_FOUND', message: 'No such ship' } };

      await expect(createRestFleetDoor(base).person.exchange('aeolus_ct_v1_charlotte', { otherShipId: OTHER, start: { kind: 'newest' }, limit: 20 })).resolves.toEqual({ isOk: false, error: { code: 'NOT_FOUND', message: 'No such ship' } });
    });

    it('lists the exchanges after a cursor, each with its other ship and newest message', async () => {
      const exchange = { otherShipId: OTHER, otherShipName: 'tracker', otherShipType: 'tracker', otherShipKind: 'agent', unacknowledged: 2, newestMessage: { messageId: 'msg_01m3tbfspe96yf1rnr4ank0003', senderShipId: OTHER, payload: 'Build is red', isPayloadUnreadable: false, contentType: 'text/plain', sentAt: '2026-11-06T10:00:00.000Z' } };
      answer = { status: 200, body: { items: [exchange], nextCursor: 'msg_01m3tbfspe96yf1rnr4ank0003' } };

      const page = await createRestFleetDoor(base).person.exchanges('aeolus_ct_v1_charlotte', { cursor: 'msg_01m3tbfspe96yf1rnr4ank0009', limit: 20 });

      expect(page).toEqual({ isOk: true, value: { items: [exchange], nextCursor: 'msg_01m3tbfspe96yf1rnr4ank0003' } });
      expect(sent().map(({ url, body }) => ({ url, body }))).toEqual([{ url: '/api/v1/ship/exchanges', body: { cursor: 'msg_01m3tbfspe96yf1rnr4ank0009', limit: 20 } }]);
    });

    it('lists the newest exchanges when no cursor is given', async () => {
      answer = { status: 200, body: { items: [], nextCursor: null } };

      await createRestFleetDoor(base).person.exchanges('aeolus_ct_v1_charlotte', { cursor: null, limit: 20 });

      expect(sent().map(({ body }) => body)).toEqual([{ limit: 20 }]);
    });

    it('marks an exchange seen up to a message and says how many it acknowledged', async () => {
      answer = { status: 200, body: { acknowledged: 3 } };

      const marked = await createRestFleetDoor(base).person.ackUpTo('aeolus_ct_v1_charlotte', { otherShipId: OTHER, messageId: 'msg_01m3tbfspe96yf1rnr4ank0003' });

      expect(marked).toEqual({ isOk: true, value: { acknowledged: 3 } });
      expect(sent().map(({ url, body }) => ({ url, body }))).toEqual([{ url: '/api/v1/ship/ackUpTo', body: { otherShipId: OTHER, messageId: 'msg_01m3tbfspe96yf1rnr4ank0003' } }]);
    });

    it('answers the fleet\'s refusal of a mark that a ship other than a person ship made', async () => {
      answer = { status: 403, body: { code: 'FORBIDDEN', message: "Only a person ship's crew marks an exchange seen" } };

      await expect(createRestFleetDoor(base).person.ackUpTo('aeolus_ct_v1_charlotte', { otherShipId: OTHER, messageId: 'msg_01m3tbfspe96yf1rnr4ank0003' })).resolves.toMatchObject({ isOk: false, error: { code: 'FORBIDDEN' } });
    });
  });

  it('forwards shouldSkipHanded to the push receive of a person ship, and leaves it out when not asked', async () => {
    answer = { status: 200, body: { deliveries: [] } };

    await createRestFleetDoor(base).person.pushReceive('aeolus_ct_v1_charlotte', { max: 10, shouldSkipHanded: true });
    await createRestFleetDoor(base).person.pushReceive('aeolus_ct_v1_charlotte', { max: 10 });

    expect(sent().map(({ body }) => body)).toEqual([
      { max: 10, waker: 'gateway', shouldSkipHanded: true },
      { max: 10, waker: 'gateway' },
    ]);
  });

  it('forwards the deliveries to leave out to the push receive of a person ship', async () => {
    answer = { status: 200, body: { deliveries: [] } };

    await createRestFleetDoor(base).person.pushReceive('aeolus_ct_v1_charlotte', { max: 10, excluding: ['dlv_01m3tbfspe96yf1rnr4ank0001', 'dlv_01m3tbfspe96yf1rnr4ank0002'] });

    expect(sent().map(({ body }) => body)).toEqual([{ max: 10, waker: 'gateway', excluding: ['dlv_01m3tbfspe96yf1rnr4ank0001', 'dlv_01m3tbfspe96yf1rnr4ank0002'] }]);
  });

  it("replies to the sender's ship, in reply to its message, under the key given", async () => {
    answer = { status: 200, body: { messageId: 'msg_01m3tbfspe96yf1rnr4ank0009', isNew: true } };

    await createRestFleetDoor(base).person.reply('aeolus_ct_v1_charlotte', { to: 'shp_01m3tbfspe96yf1rnr4ank9trk', inReplyTo: 'msg_01m3tbfspe96yf1rnr4ank0001', contentType: 'text/plain', payload: 'Go', idempotencyKey: 'answer-dlv' });

    expect(sent().map(({ url, body }) => ({ url, body }))).toEqual([
      { url: '/api/v1/ship/send', body: { selector: { kind: 'ship', shipId: 'shp_01m3tbfspe96yf1rnr4ank9trk' }, inReplyTo: 'msg_01m3tbfspe96yf1rnr4ank0001', contentType: 'text/plain', payload: 'Go', idempotencyKey: 'answer-dlv' } },
    ]);
  });

  it('reads a delivery the person opened again, whole, by its id', async () => {
    answer = {
      status: 200,
      body: {
        deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001',
        messageId: 'msg_01m3tbfspe96yf1rnr4ank0001',
        senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9trk',
        senderName: 'tracker',
        senderType: 'tracker',
        senderStatus: 'crewed',
        recipient: { kind: 'ship', shipId: 'shp_01m3tbfspe96yf1rnr4ank0per' },
        model: null,
        contentType: 'application/vnd.aeolus.question+json',
        payload: JSON.stringify(QUESTION),
        sentAt: '2026-10-19T08:00:00.000Z',
        inReplyTo: null,
        attempts: 1,
        isForced: false,
        meetingId: 'mtg_01m5qa5j85mgd4z61d9c2k4mtg',
        scheduleId: null,
        sendTime: null,
        state: 'acknowledged',
      },
    };

    const reread = await createRestFleetDoor(base).person.delivery('aeolus_ct_v1_charlotte', 'dlv_01m3tbfspe96yf1rnr4ank0001');

    expect(reread).toEqual({
      isOk: true,
      value: {
        deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001',
        messageId: 'msg_01m3tbfspe96yf1rnr4ank0001',
        senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9trk',
        senderName: 'tracker',
        contentType: 'application/vnd.aeolus.question+json',
        payload: JSON.stringify(QUESTION),
        headline: 'Go for release 1.4?',
        askedQuestionId: QUESTION.id,
        withdrawnQuestionId: null,
        stepId: null,
        withdrawnStepId: null,
        pick: 1,
        stepLink: null,
        sentAt: new Date('2026-10-19T08:00:00.000Z'),
        inReplyTo: null,
        meetingId: 'mtg_01m5qa5j85mgd4z61d9c2k4mtg',
        senderStatus: 'crewed',
      },
    });
    expect(sent()).toEqual([{ url: '/api/v1/ship/delivery', authorization: 'Bearer aeolus_ct_v1_charlotte', accountToken: undefined, body: { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001' } }]);
  });

  it.each([
    ['ack', '/api/v1/ship/ack'],
    ['handled', '/api/v1/ship/handled'],
  ] as const)('%s a delivery by its id', async (what, url) => {
    answer = { status: 200, body: {} };

    await createRestFleetDoor(base).person[what]('aeolus_ct_v1_charlotte', 'dlv_01m3tbfspe96yf1rnr4ank0001');

    expect(sent().map((call) => ({ url: call.url, body: call.body }))).toEqual([{ url, body: { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001' } }]);
  });
});

describe("the meeting calls the gateway makes as the crew of a person's ship (decision 0061)", () => {
  const MEETING = 'mtg_01m5qa5j85mgd4z61d9c2k4mtg';
  const CHIEF = { id: 'shp_01m5qa5j85mgd4z61d9c2kchf0', name: 'chief-of-staff' };
  const CHARLOTTE = { id: PERSON_SHIP, name: 'charlotte' };

  it('reads a meeting and a page of its contributions after the cursor', async () => {
    answer = {
      status: 200,
      body: {
        meetingId: MEETING,
        title: 'Weekly heads',
        owner: CHIEF,
        moderator: CHIEF,
        openedAt: '2026-10-24T09:00:00.000Z',
        endedAt: null,
        participants: [
          { ...CHIEF, kind: 'plugin', status: 'crewed', state: 'present' },
          { ...CHARLOTTE, kind: 'person', status: 'awaitingCrew', state: 'left' },
        ],
        mic: { holder: CHARLOTTE, pattern: 'fifo', requests: [{ ship: CHIEF, requestedAt: '2026-10-24T09:02:00.000Z' }] },
        contributions: {
          items: [{ messageId: 'msg_01m5qa5j85mgd4z61d9c2k0002', sender: CHIEF, payload: 'Marketing first', isPayloadUnreadable: false, contentType: 'text/plain', model: 'claude-opus-5-5', sentAt: '2026-10-24T09:01:00.000Z' }],
          nextCursor: 'msg_01m5qa5j85mgd4z61d9c2k0002',
        },
      },
    };

    const read = await createRestFleetDoor(base).meetings.meeting('aeolus_ct_v1_charlotte', { meetingId: MEETING, cursor: 'msg_01m5qa5j85mgd4z61d9c2k0003' });

    expect(read).toEqual({
      isOk: true,
      value: {
        meetingId: MEETING,
        title: 'Weekly heads',
        owner: { shipId: CHIEF.id, name: 'chief-of-staff' },
        moderator: { shipId: CHIEF.id, name: 'chief-of-staff' },
        openedAt: new Date('2026-10-24T09:00:00.000Z'),
        endedAt: null,
        participants: [
          { shipId: CHIEF.id, name: 'chief-of-staff', kind: 'plugin', status: 'crewed', state: 'present' },
          { shipId: PERSON_SHIP, name: 'charlotte', kind: 'person', status: 'awaitingCrew', state: 'left' },
        ],
        mic: { holder: { shipId: PERSON_SHIP, name: 'charlotte' }, pattern: 'fifo', requests: [{ ship: { shipId: CHIEF.id, name: 'chief-of-staff' }, requestedAt: new Date('2026-10-24T09:02:00.000Z') }] },
        contributions: {
          items: [{ messageId: 'msg_01m5qa5j85mgd4z61d9c2k0002', sender: { shipId: CHIEF.id, name: 'chief-of-staff' }, contentType: 'text/plain', payload: 'Marketing first', sentAt: new Date('2026-10-24T09:01:00.000Z') }],
          nextCursor: 'msg_01m5qa5j85mgd4z61d9c2k0002',
        },
      },
    });
    expect(sent()).toEqual([{ url: '/api/v1/ship/meeting', authorization: 'Bearer aeolus_ct_v1_charlotte', accountToken: undefined, body: { meetingId: MEETING, cursor: 'msg_01m5qa5j85mgd4z61d9c2k0003' } }]);
  });

  it.each([
    ['request', '/api/v1/ship/requestMic'],
    ['withdraw', '/api/v1/ship/withdrawMicRequest'],
    ['release', '/api/v1/ship/releaseMic'],
  ] as const)('makes the %s mic call on the meeting', async (change, url) => {
    answer = { status: 200, body: {} };

    await expect(createRestFleetDoor(base).meetings.changeMic('aeolus_ct_v1_charlotte', { meetingId: MEETING, change })).resolves.toEqual({ isOk: true, value: undefined });
    expect(sent()).toEqual([{ url, authorization: 'Bearer aeolus_ct_v1_charlotte', accountToken: undefined, body: { meetingId: MEETING } }]);
  });

  it("answers the fleet's refusal of a mic call", async () => {
    answer = { status: 409, body: { code: 'CONFLICT', message: 'You already requested the mic' } };

    await expect(createRestFleetDoor(base).meetings.changeMic('aeolus_ct_v1_charlotte', { meetingId: MEETING, change: 'request' })).resolves.toEqual({
      isOk: false,
      error: { code: 'CONFLICT', message: 'You already requested the mic' },
    });
  });
});

describe('the scopes the fleet lists, read as the gateway\'s ship (fleet.scopes, gateway scopes 4.2)', () => {
  it("answers every listed scope with its description, core's, a plugin's and the fleet's own", async () => {
    answer = {
      status: 200,
      body: [
        { namespace: 'fleet', kind: 'core', declaredBy: null, scopes: [{ scope: 'fleet:read', description: 'Read the fleet' }] },
        { namespace: 'gateway', kind: 'plugin', declaredBy: { id: 'shp_01m3tbfspe96yf1rnr4ank9h1a', name: 'gateway' }, scopes: [{ scope: 'gateway:approve', description: 'Approve outside parties' }] },
        { namespace: 'crm', kind: 'fleet', declaredBy: null, scopes: [{ scope: 'crm:read-leads', description: 'Read leads in the CRM' }, { scope: 'crm:write-leads', description: 'Change leads in the CRM' }] },
      ],
    };

    await expect(createRestFleetDoor(base).listScopes('aeolus_ct_v1_gateway')).resolves.toEqual({
      isOk: true,
      value: [
        { scope: 'fleet:read', description: 'Read the fleet' },
        { scope: 'gateway:approve', description: 'Approve outside parties' },
        { scope: 'crm:read-leads', description: 'Read leads in the CRM' },
        { scope: 'crm:write-leads', description: 'Change leads in the CRM' },
      ],
    });
    expect(received.map(({ url, headers }) => ({ url, authorization: headers.authorization }))).toEqual([{ url: '/api/v1/fleet/scopes', authorization: 'Bearer aeolus_ct_v1_gateway' }]);
  });

  it("answers the fleet's refusal", async () => {
    answer = { status: 403, body: { code: 'FORBIDDEN', message: 'Needs fleet:read' } };

    await expect(createRestFleetDoor(base).listScopes('aeolus_ct_v1_gateway')).resolves.toEqual({ isOk: false, error: { code: 'FORBIDDEN', message: 'Needs fleet:read' } });
  });
});

describe('where the delivery of a message a proxy ship sent stands, as sentMessage answers (common 0.32.0)', () => {
  it("reads the id, state and since of the message's one delivery to the ship it went to", async () => {
    answer = {
      status: 200,
      body: {
        messageId: 'msg_01m3tb1zgr5h2ffee12xnch8pp',
        sentAt: '2026-10-26T07:00:00.000Z',
        recipient: { kind: 'ship', ship: { id: PERSON_SHIP, name: 'supplier' } },
        deliveries: [{ deliveryId: 'dlv_01m3tb1zgr5h2ffee12xnch8pp', ship: { id: PERSON_SHIP, name: 'supplier' }, state: 'handed', since: '2026-10-26T07:00:05.000Z' }],
      },
    };

    await expect(createRestFleetDoor(base).sentMessage('aeolus_ct_v1_gateway', 'msg_01m3tb1zgr5h2ffee12xnch8pp')).resolves.toEqual({ isOk: true, value: { deliveryId: 'dlv_01m3tb1zgr5h2ffee12xnch8pp', state: 'handed', since: new Date('2026-10-26T07:00:05.000Z') } });
  });
});
