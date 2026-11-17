import type { DeliveryId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID, memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { err, ok } from '../shared/result.js';
import { createAnswerPings } from './answer-pings.js';
import type { GatewayDelivery, GatewayInbox } from './ports.js';

// The gateway's own ship answers argo's ping with pong, as any crewed ship
// does (blueprint, "Ping"), and acks what else reaches it: it handles no
// messages of its own, and the fleet keeps them in its history.

const PING: GatewayDelivery = { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9png', contentType: 'application/vnd.aeolus.ping', senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9arg' };
const ANSWER: GatewayDelivery = { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9ans', contentType: 'application/vnd.aeolus.answer+json', senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9chr' };

function anInbox(waiting: GatewayDelivery[] | 'refused'): GatewayInbox & { ponged: DeliveryId[]; acked: DeliveryId[] } {
  const ponged: DeliveryId[] = [];
  const acked: DeliveryId[] = [];
  return {
    ponged,
    acked,
    receive: () => Promise.resolve(waiting === 'refused' ? err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' }) : ok(waiting.splice(0))),
    pong: (_crewToken, deliveryId) => {
      ponged.push(deliveryId);
      return Promise.resolve(ok(undefined));
    },
    ack: (_crewToken, deliveryId) => {
      acked.push(deliveryId);
      return Promise.resolve(ok(undefined));
    },
  };
}

async function connected() {
  const connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: 'shp_01m3tbfspe96yf1rnr4ank9gtw', name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: new Date('2026-10-22T10:00:00Z') });
  return connections;
}

describe("the gateway's ship takes what waits for it", () => {
  it("answers argo's ping with pong, never an ack", async () => {
    const inbox = anInbox([PING]);

    await expect(createAnswerPings({ connections: await connected(), inbox })(new AbortController().signal)).resolves.toEqual({ ponged: 1, acked: [], refused: 0 });
    expect({ ponged: inbox.ponged, acked: inbox.acked }).toEqual({ ponged: [PING.deliveryId], acked: [] });
  });

  it('acks any other delivery, saying which it was', async () => {
    const inbox = anInbox([ANSWER]);

    await expect(createAnswerPings({ connections: await connected(), inbox })(new AbortController().signal)).resolves.toEqual({ ponged: 0, acked: [ANSWER], refused: 0 });
    expect(inbox.acked).toEqual([ANSWER.deliveryId]);
  });

  it('counts a fleet that does not answer, and takes nothing there', async () => {
    const inbox = anInbox('refused');

    await expect(createAnswerPings({ connections: await connected(), inbox })(new AbortController().signal)).resolves.toEqual({ ponged: 0, acked: [], refused: 1 });
  });

  it('takes nothing for a fleet it is not connected to', async () => {
    const inbox = anInbox([PING]);

    await expect(createAnswerPings({ connections: memoryConnectionStore(), inbox })(new AbortController().signal)).resolves.toEqual({ ponged: 0, acked: [], refused: 0 });
    expect(inbox.ponged).toEqual([]);
  });
});


it('receives only for the gateway lease whose fleet woke', async () => {
  const connections = await connected();
  await connections.save({ fleetId: OTHER_FLEET_ID, shipId: 'shp_01m3tbfspe96yf1rnr4ank9gtw', name: 'other', crewToken: 'other-crew', crewedAt: new Date('2026-11-01') });
  const received: string[] = [];
  const inbox = { ...anInbox([]), receive: (token: string) => { received.push(token); return Promise.resolve(ok([])); } };
  await createAnswerPings({ connections, inbox })(new AbortController().signal, FLEET_ID);
  expect(received).toEqual(['aeolus_ct_v1_gateway']);
});

it('forgets an ended gateway lease without dropping a replacement', async () => {
  const connections = await connected();
  const inbox = { ...anInbox([]), receive: () => Promise.resolve(err({ code: 'LEASE_ENDED', message: 'ended' })) };
  await createAnswerPings({ connections, inbox })(new AbortController().signal, FLEET_ID);
  expect(await connections.find(FLEET_ID)).toBeUndefined();
});

it('a receive refused for an old lease never drops its replacement', async () => {
  const connections = await connected();
  const original = await connections.find(FLEET_ID);
  const inbox = { ...anInbox([]), receive: async () => {
    if (original !== undefined) { await connections.save({ ...original, crewToken: 'replacement' }); }
    return err({ code: 'LEASE_ENDED', message: 'old lease ended' });
  } };
  await createAnswerPings({ connections, inbox })(new AbortController().signal, FLEET_ID);
  expect((await connections.find(FLEET_ID))?.crewToken).toBe('replacement');
});
