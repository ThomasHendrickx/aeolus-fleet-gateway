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
    expect(sent().map(({ url, body }) => ({ url, body }))).toEqual([{ url: '/api/v1/ship/pushReceive', body: { max: 10 } }]);
  });

  it("replies to the sender's ship, in reply to its message, under the key given", async () => {
    answer = { status: 200, body: { messageId: 'msg_01m3tbfspe96yf1rnr4ank0009', isNew: true } };

    await createRestFleetDoor(base).person.reply('aeolus_ct_v1_charlotte', { to: 'shp_01m3tbfspe96yf1rnr4ank9trk', inReplyTo: 'msg_01m3tbfspe96yf1rnr4ank0001', contentType: 'text/plain', payload: 'Go', idempotencyKey: 'answer-dlv' });

    expect(sent().map(({ url, body }) => ({ url, body }))).toEqual([
      { url: '/api/v1/ship/send', body: { selector: { kind: 'ship', shipId: 'shp_01m3tbfspe96yf1rnr4ank9trk' }, inReplyTo: 'msg_01m3tbfspe96yf1rnr4ank0001', contentType: 'text/plain', payload: 'Go', idempotencyKey: 'answer-dlv' } },
    ]);
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
