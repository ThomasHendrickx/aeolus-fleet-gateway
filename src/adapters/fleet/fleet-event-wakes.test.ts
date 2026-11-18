import Fastify from 'fastify';
import { afterEach, expect, it, vi } from 'vitest';

import { anArgoEntry, ARGO_SHIP_ID, fakeArgoInboxFleet } from '../../../test/support/argo-inbox-fakes.js';
import { FLEET_ID, SHIP_ID, memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { createFollowArgoInbox } from '../../core/argo-inbox/follow-argo-inbox.js';
import { createWatchGatewayShips } from '../../core/connection/watch-gateway-ships.js';
import { createRoundWorker } from '../../round-worker.js';
import { createShipWakeups } from './ship-wakeups.js';

const flush = () => vi.advanceTimersByTimeAsync(0);
afterEach(() => vi.useRealTimers());

async function setup() {
  vi.useFakeTimers();
  const connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'test-crew', crewedAt: new Date('2026-11-18') });
  const fleet = fakeArgoInboxFleet();
  const follow = createFollowArgoInbox({ connections, door: fleet.door });
  await follow.round(new AbortController().signal);
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const requests: { url: string; headers: Headers }[] = [];
  const wakeups = createShipWakeups({ fleetUrl: 'https://fleet.test', stream: 'fleet', random: () => 0, fetch: (url, init) => {
    requests.push({ url: typeof url === 'string' ? url : url instanceof URL ? url.href : url.url, headers: new Headers(init?.headers) });
    return Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start: (controller) => { streams.push(controller); } })));
  } });
  const stop = new AbortController();
  const worker = createRoundWorker({ name: 'argo inbox', round: () => follow.round(stop.signal), intervalMs: 2000, log: Fastify().log,
    sleep: (ms, signal) => new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      function done() { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }
      signal.addEventListener('abort', done, { once: true });
    }),
  });
  worker.start();
  const watcher = createWatchGatewayShips({ connections, wakeups, isServed: () => Promise.resolve(true), look: () => { worker.wake(); return Promise.resolve(); }, failed: (error) => { throw error; } });
  await watcher.reconcile();
  await flush();
  const write = (text: string) => streams.at(-1)?.enqueue(new TextEncoder().encode(text));
  const messages = () => {
    const inbox = follow.inboxOf(FLEET_ID);
    return inbox?.kind === 'read' ? inbox.messages.map(({ messageId }) => messageId) : [];
  };
  return { fleet, requests, streams, write, messages, stop: async () => { stop.abort(); await watcher.stop(); await worker.stop(); } };
}

it('an authorised fleet event refreshes an argo delivery without waiting for the safety poll', async () => {
  const test = await setup();
  try {
    test.fleet.send(anArgoEntry(1));
    const entry = anArgoEntry(1);
    const event = { seq: 1, id: 'evt_01m3tbfspe96yf1rnr4ank9001', type: 'MessageAccepted', occurredAt: '2026-11-18T12:00:00.000Z', actorKind: 'ship', actorShipId: SHIP_ID, actorAccountId: null, actorSignedInAccountId: null, shipId: ARGO_SHIP_ID, messageId: entry.messageId, deliveryId: entry.deliveryId };
    test.write(`id: 1\ndata: ${JSON.stringify({ kind: 'event', event })}\n\n`);
    await flush();
    expect(test.messages()).toEqual([anArgoEntry(1).messageId]);
    expect(test.requests[0]?.url).toBe('https://fleet.test/api/v1/fleet/events');
    expect(test.requests[0]?.headers.get('authorization')).toBe('Bearer test-crew');
  } finally { await test.stop(); }
});

it('reconnects from the last stream id and follows changes committed while disconnected', async () => {
  const test = await setup();
  try {
    test.write('id: 17\ndata: {"kind":"resync"}\n\n');
    await flush();
    test.streams[0]?.close();
    await flush();
    test.fleet.send(anArgoEntry(2));
    await vi.advanceTimersByTimeAsync(1000);
    expect(test.messages()).toEqual([anArgoEntry(2).messageId]);
    expect(test.requests[1]?.headers.get('last-event-id')).toBe('17');
  } finally { await test.stop(); }
});

it('the two-second safety look recovers an argo delivery whose event wake was missed', async () => {
  const test = await setup();
  try {
    test.fleet.send(anArgoEntry(3));
    await vi.advanceTimersByTimeAsync(1999);
    expect(test.messages()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(test.messages()).toEqual([anArgoEntry(3).messageId]);
  } finally { await test.stop(); }
});
