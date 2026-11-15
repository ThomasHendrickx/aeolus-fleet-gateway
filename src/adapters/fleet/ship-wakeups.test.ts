import { afterEach, describe, expect, it, vi } from 'vitest';

import { createShipWakeups } from './ship-wakeups.js';

const WAKE = 'event: wake\ndata: {"reason":"open"}\n\n';
function stream() {
  let writer: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({ start(controller) { writer = controller; } });
  return { response: new Response(body), write: (text: string) => writer?.enqueue(new TextEncoder().encode(text)), end: () => writer?.close() };
}
function setup(responses: (Response | Error)[] = []) {
  vi.useFakeTimers();
  const requests: RequestInit[] = [];
  const urls: string[] = [];
  const streams = [stream(), stream()];
  const open = createShipWakeups({ fleetUrl: 'https://fleet.test', random: () => 0, fetch: async (url, init) => {
    urls.push(String(url));
    requests.push(init ?? {});
    const response = responses.shift() ?? streams[requests.length - 1]?.response;
    if (response instanceof Error) { throw response; }
    return response ?? new Response(null, { status: 503 });
  } });
  const stop = new AbortController();
  const hints = open('test-crew', stop.signal);
  return { hints, stop, requests, urls, streams };
}
async function flush() { await vi.advanceTimersByTimeAsync(0); }
afterEach(() => vi.useRealTimers());

describe('lease wake streams', () => {
  it('opens REST SSE with the lease and reads fragmented wakes before stream closure', async () => {
    const test = setup();
    test.streams[0]?.write('event: wa');
    await flush();
    test.streams[0]?.write('ke\r\ndata: {}\r\n\r\n');
    await flush();
    expect(await test.hints.wait()).toBe(true);
    expect(test.urls).toEqual(['https://fleet.test/api/v1/ship/wakeups']);
    expect(test.requests[0]?.headers).toEqual({ authorization: 'Bearer test-crew', accept: 'text/event-stream' });
    test.stop.abort();
  });
  it('coalesces wakes during an in-flight look into exactly one more serialized look', async () => {
    const test = setup();
    test.streams[0]?.write(WAKE);
    await flush();
    expect(await test.hints.wait()).toBe(true);
    test.streams[0]?.write(WAKE + WAKE + WAKE);
    await flush();
    expect(await test.hints.wait()).toBe(true);
    let isAnother = false;
    const next = test.hints.wait().then((look) => { isAnother = look; });
    await flush();
    expect(isAnother).toBe(false);
    test.stop.abort();
    await next;
  });
  it('reopens a dropped stream after the spread and finds what was stored while down', async () => {
    const test = setup();
    test.streams[0]?.end();
    await flush();
    await vi.advanceTimersByTimeAsync(999);
    expect(test.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    test.streams[1]?.write(WAKE);
    await flush();
    expect(await test.hints.wait()).toBe(true);
    expect(test.requests).toHaveLength(2);
    test.stop.abort();
  });
  it.each([new Error('network'), new Response('{"code":"UNAUTHORIZED"}', { status: 401 }), new Response(null, { status: 503 })])('reopens a refused or failed opening with LD3 backoff: %s', async (response) => {
    const test = setup([response]);
    await flush();
    await vi.advanceTimersByTimeAsync(999);
    expect(test.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(test.requests).toHaveLength(2);
    test.stop.abort();
  });
  it('doubles failed reconnect delays to sixty seconds', async () => {
    const test = setup(Array.from({ length: 10 }, () => new Response(null, { status: 503 })));
    await flush();
    for (const delay of [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]) {
      const count = test.requests.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(test.requests).toHaveLength(count);
      await vi.advanceTimersByTimeAsync(1);
      expect(test.requests).toHaveLength(count + 1);
    }
    test.stop.abort();
  });
  it('reopens after exactly sixty seconds without bytes', async () => {
    const test = setup();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(test.requests[0]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(test.requests[0]?.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(test.requests).toHaveLength(2);
    test.stop.abort();
  });
  it('looks after five minutes without a wake while comments keep the stream open', async () => {
    const test = setup();
    let isReady = false;
    const next = test.hints.wait().then((value) => { isReady = value; });
    for (let count = 0; count < 11; count += 1) {
      await vi.advanceTimersByTimeAsync(25_000);
      test.streams[0]?.write(': keepalive\n\n');
      await flush();
    }
    await vi.advanceTimersByTimeAsync(24_999);
    expect(isReady).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await next;
    expect(isReady).toBe(true);
    test.stop.abort();
  });
  it.each(['opening', 'event'])('stops on LEASE_ENDED at %s without reopening', async (where) => {
    const test = setup(where === 'opening' ? [new Response('{"code":"LEASE_ENDED"}', { status: 401 })] : []);
    if (where === 'event') { test.streams[0]?.write('event: end\ndata: {"code":"LEASE_ENDED"}\n\n'); }
    await flush();
    expect(await test.hints.wait()).toBe(false);
    expect(test.hints.isEnded()).toBe(true);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(test.requests).toHaveLength(1);
  });
  it('stop aborts an open stream and clears pending wakes and reopening', async () => {
    const test = setup();
    test.streams[0]?.write(WAKE);
    await flush();
    test.stop.abort();
    expect(test.requests[0]?.signal?.aborted).toBe(true);
    expect(await test.hints.wait()).toBe(false);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(test.requests).toHaveLength(1);
  });
  it('does not open for an already stopped lease', async () => {
    const test = setup();
    test.stop.abort();
    const open = createShipWakeups({ fleetUrl: 'https://fleet.test', fetch: async () => { throw new Error('must not fetch'); } });
    expect(await open('stopped', test.stop.signal).wait()).toBe(false);
  });
});
