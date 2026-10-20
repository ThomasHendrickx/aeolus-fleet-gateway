import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { FLEET_ID, OTHER_FLEET_ID, SHIP_ID, memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { OWNER_SHIP_ID } from '../../../test/support/party-fakes.js';
import { fakeOwners, memoryOwnerQuestions, memoryPendingRequests } from '../../../test/support/request-fakes.js';
import type { CallSender } from '../mcp-in/ports.js';
import { err, ok } from '../shared/result.js';
import { createAskOwners } from './ask-owners.js';
import type { PendingRequest } from './ports.js';

// The gateway asks its owner by question when a request opens (decision
// 0056, 0038): the owner of the gateway's ship, read from the fleet. The
// question points to the gateway's overview, where any approver decides
// (Q5 b), and is withdrawn once the request is decided or expired. Neither
// is lost: one the fleet did not store is sent again under the same key.

const NOW = new Date('2026-10-21T09:00:00.000Z');
const OVERVIEW = 'https://gateway.example.com/overview';
const QUESTION = 'application/vnd.aeolus.question+json';
const WITHDRAWAL = 'application/vnd.aeolus.question-withdrawal+json';
const QUESTION_ID = '0b5f3c1e-7d4a-4c2b-9f1e-2a6d8c4b1e01';

/** A sent payload as JSON. */
const payloadOf = (text: string): unknown => JSON.parse(text);

function aRequest(overrides: Partial<PendingRequest> = {}): PendingRequest {
  return {
    fleetId: FLEET_ID,
    requestId: 'req_1',
    subject: { kind: 'client', clientId: 'https://orderbot.example.com/client.json', clientName: 'Orderbot' },
    requesters: [{ accountId: 'acc-charlotte', personShipId: null }],
    askedAt: new Date('2026-10-20T09:00:00.000Z'),
    expiresAt: new Date('2026-10-27T09:00:00.000Z'),
    state: 'pending',
    decidedBy: null,
    decidedAt: null,
    ...overrides,
  };
}

let requests: ReturnType<typeof memoryPendingRequests>;
let questions: ReturnType<typeof memoryOwnerQuestions>;
let connections: ReturnType<typeof memoryConnectionStore>;
let sent: { crewToken: string; to: ShipId; contentType: string; payload: string; idempotencyKey: string }[];
let answer: 'stored' | 'unavailable' | 'refused';
let now: Date;

beforeEach(async () => {
  requests = memoryPendingRequests();
  questions = memoryOwnerQuestions(requests);
  connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: NOW });
  sent = [];
  answer = 'stored';
  now = NOW;
});

const sender: CallSender = {
  send: (crewToken, message) => {
    sent.push({ crewToken, ...message });
    if (answer === 'unavailable') {
      return Promise.resolve(err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' }));
    }
    return Promise.resolve(answer === 'refused' ? err({ code: 'FORBIDDEN', message: 'Your ship may not reach this ship' }) : ok({ messageId: 'msg_01m5cgv0000000000000000001' }));
  },
};

function askOwners() {
  return createAskOwners({ questions, connections, owners: fakeOwners({ [SHIP_ID]: OWNER_SHIP_ID }), sender, newQuestionId: () => QUESTION_ID, clock: { now: () => now }, overviewUrl: OVERVIEW })();
}

describe("the gateway asks its owner when a request opens", () => {
  it("sends the owner of the gateway's ship one question pointing to the overview, under a key of the request, and keeps that it asked", async () => {
    requests.held.push(aRequest());

    await expect(askOwners()).resolves.toEqual({ asked: 1, withdrawn: 0, kept: 0, refused: 0 });
    expect({ sent: sent.map(({ payload, ...rest }) => ({ ...rest, payload: payloadOf(payload) })), held: questions.held }).toEqual({
      sent: [
        {
          crewToken: 'aeolus_ct_v1_gateway',
          to: OWNER_SHIP_ID,
          contentType: QUESTION,
          idempotencyKey: 'req_1:question',
          payload: {
            id: QUESTION_ID,
            title: 'Orderbot asks for access to the fleet',
            context: `An MCP client asks to act in the fleet as an outside party. Asked by 1 person on 2026-10-20; it waits until 2026-10-27, then expires. Any holder of gateway:approve decides on ${OVERVIEW}.`,
            options: [{ key: 1, label: "Decide on the gateway's page", detail: OVERVIEW }],
            pick: { option: 1, why: 'Approving names the outside party, its owner and its scopes, which the page asks for.' },
          },
        },
      ],
      held: [{ fleetId: FLEET_ID, requestId: 'req_1', questionId: QUESTION_ID, askedShipId: OWNER_SHIP_ID, askedAt: NOW, withdrawnAt: null }],
    });
  });

  it('titles a request for an outside MCP server by its address', async () => {
    requests.held.push(aRequest({ subject: { kind: 'server', url: 'https://mcp.linear.app/mcp' } }));

    await askOwners();

    expect(sent.map(({ payload }) => z.object({ title: z.string() }).parse(payloadOf(payload)).title)).toEqual(['Someone asks to add https://mcp.linear.app/mcp to the fleet']);
  });

  it('asks once per request', async () => {
    requests.held.push(aRequest());
    await askOwners();

    await expect(askOwners()).resolves.toEqual({ asked: 0, withdrawn: 0, kept: 0, refused: 0 });
    expect(sent).toHaveLength(1);
  });

  it('asks again under the same question and key when the fleet did not answer', async () => {
    requests.held.push(aRequest());
    answer = 'unavailable';
    await expect(askOwners()).resolves.toMatchObject({ kept: 1 });
    answer = 'stored';

    await askOwners();

    expect(sent.map(({ idempotencyKey, payload }) => [idempotencyKey, z.object({ id: z.string() }).parse(payloadOf(payload)).id])).toEqual([
      ['req_1:question', QUESTION_ID],
      ['req_1:question', QUESTION_ID],
    ]);
  });

  it('asks no more when the fleet refused the question', async () => {
    requests.held.push(aRequest());
    answer = 'refused';
    await expect(askOwners()).resolves.toMatchObject({ refused: 1 });

    await askOwners();

    expect(sent).toHaveLength(1);
  });

  it('asks nothing about a request decided or expired, or of a fleet the gateway is not connected to', async () => {
    requests.held.push(aRequest({ state: 'denied' }), aRequest({ requestId: 'req_2', expiresAt: NOW }), aRequest({ requestId: 'req_3', fleetId: OTHER_FLEET_ID }));

    await expect(askOwners()).resolves.toEqual({ asked: 0, withdrawn: 0, kept: 1, refused: 0 });
    expect(sent).toEqual([]);
  });
});

describe('the gateway withdraws its question once the request is decided or expired', () => {
  it.each([
    ['decided', (request: PendingRequest): PendingRequest => ({ ...request, state: 'approved' })],
    ['expired', (request: PendingRequest): PendingRequest => request],
  ])('withdraws it from the ship it asked once the request is %s, under a key of the request, once', async (what, ended) => {
    requests.held.push(aRequest());
    await askOwners();
    requests.held.splice(0, 1, ended(aRequest()));
    now = what === 'expired' ? new Date('2026-10-27T09:00:00.000Z') : NOW;

    const first = await askOwners();
    const second = await askOwners();

    expect({ first, second, last: sent.at(-1), sent: sent.length }).toEqual({
      first: { asked: 0, withdrawn: 1, kept: 0, refused: 0 },
      second: { asked: 0, withdrawn: 0, kept: 0, refused: 0 },
      last: { crewToken: 'aeolus_ct_v1_gateway', to: OWNER_SHIP_ID, contentType: WITHDRAWAL, payload: JSON.stringify({ questionId: QUESTION_ID }), idempotencyKey: 'req_1:withdrawal' },
      sent: 2,
    });
  });
});
