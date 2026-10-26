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

    expect(taken.isOk ? taken.value.map(({ questionTitle, sentAt }) => ({ questionTitle, sentAt })) : taken).toEqual([
      { questionTitle: 'Go for release 1.4?', sentAt: new Date('2026-10-19T08:00:00.000Z') },
      { questionTitle: null, sentAt: new Date('2026-10-19T08:00:00.000Z') },
    ]);
    expect(sent().map(({ url, body }) => ({ url, body }))).toEqual([{ url: '/api/v1/ship/pushReceive', body: { max: 10, waker: 'gateway' } }]);
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
        questionTitle: 'Go for release 1.4?',
        sentAt: new Date('2026-10-19T08:00:00.000Z'),
        inReplyTo: null,
        meetingId: 'mtg_01m5qa5j85mgd4z61d9c2k4mtg',
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
          items: [{ messageId: 'msg_01m5qa5j85mgd4z61d9c2k0002', sender: CHIEF, payload: 'Marketing first', contentType: 'text/plain', model: 'claude-opus-5-5', sentAt: '2026-10-24T09:01:00.000Z' }],
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
  it("answers every listed scope, core's, a plugin's and the fleet's own", async () => {
    answer = {
      status: 200,
      body: [
        { namespace: 'fleet', kind: 'core', declaredBy: null, scopes: [{ scope: 'fleet:read', description: 'Read the fleet' }] },
        { namespace: 'gateway', kind: 'plugin', declaredBy: { id: 'shp_01m3tbfspe96yf1rnr4ank9h1a', name: 'gateway' }, scopes: [{ scope: 'gateway:approve', description: 'Approve outside parties' }] },
        { namespace: 'crm', kind: 'fleet', declaredBy: null, scopes: [{ scope: 'crm:read-leads', description: 'Read leads in the CRM' }, { scope: 'crm:write-leads', description: 'Change leads in the CRM' }] },
      ],
    };

    await expect(createRestFleetDoor(base).listScopes('aeolus_ct_v1_gateway')).resolves.toEqual({ isOk: true, value: ['fleet:read', 'gateway:approve', 'crm:read-leads', 'crm:write-leads'] });
    expect(received.map(({ url, headers }) => ({ url, authorization: headers.authorization }))).toEqual([{ url: '/api/v1/fleet/scopes', authorization: 'Bearer aeolus_ct_v1_gateway' }]);
  });

  it("answers the fleet's refusal", async () => {
    answer = { status: 403, body: { code: 'FORBIDDEN', message: 'Needs fleet:read' } };

    await expect(createRestFleetDoor(base).listScopes('aeolus_ct_v1_gateway')).resolves.toEqual({ isOk: false, error: { code: 'FORBIDDEN', message: 'Needs fleet:read' } });
  });
});

describe('where the delivery of a message a proxy ship sent stands, as sentMessage answers (common 0.32.0)', () => {
  it("reads the state and since of the message's one delivery to the ship it went to", async () => {
    answer = {
      status: 200,
      body: {
        messageId: 'msg_01m3tb1zgr5h2ffee12xnch8pp',
        sentAt: '2026-10-26T07:00:00.000Z',
        recipient: { kind: 'ship', ship: { id: PERSON_SHIP, name: 'supplier' } },
        deliveries: [{ deliveryId: 'dlv_01m3tb1zgr5h2ffee12xnch8pp', ship: { id: PERSON_SHIP, name: 'supplier' }, state: 'handed', since: '2026-10-26T07:00:05.000Z' }],
      },
    };

    await expect(createRestFleetDoor(base).sentMessage('aeolus_ct_v1_gateway', 'msg_01m3tb1zgr5h2ffee12xnch8pp')).resolves.toEqual({ isOk: true, value: { state: 'handed', since: new Date('2026-10-26T07:00:05.000Z') } });
  });
});
