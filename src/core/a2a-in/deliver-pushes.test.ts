import { beforeEach, describe, expect, it } from 'vitest';

import { answered, fakePoster, fakeResolver, memoryPushStore } from '../../../test/support/a2a-push-fakes.js';
import { callsWithATask, TASK_ID, TASK_SENT_AT } from '../../../test/support/a2a-task-fakes.js';
import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { err, type Result } from '../shared/result.js';
import { createDeliverPushes } from './deliver-pushes.js';
import type { PostFailure, PushConfig } from './ports.js';
import { createReadA2aTask } from './read-a2a-task.js';

const SUPPLIER = { fleetId: FLEET_ID, party: 'supplier' };
const START = new Date('2026-10-23T12:01:00.000Z');
/** The waits before each attempt again, as the gateway's own. */
const AGAIN_WAITS_MS = [1_000, 10_000, 60_000, 300_000];
const WEBHOOK = 'https://hooks.supplier.example/a2a';

let now: Date;
let store: ReturnType<typeof memoryPushStore>;
let resolver: ReturnType<typeof fakeResolver>;

const aConfig = (overrides: Partial<PushConfig> = {}): PushConfig => ({ ...SUPPLIER, taskId: TASK_ID, id: 'hook-1', url: WEBHOOK, token: 'tok-1', authentication: { scheme: 'Bearer', credentials: 'secret-1' }, createdAt: TASK_SENT_AT, noticedMark: 'm', isFollowing: true, ...overrides });

beforeEach(async () => {
  now = START;
  store = memoryPushStore();
  resolver = fakeResolver({ 'hooks.supplier.example': ['93.184.215.14'] });
  await store.save(aConfig());
  await store.notice(SUPPLIER, { taskId: TASK_ID, id: 'hook-1', mark: 'm1', isFollowing: true, events: ['status:working'], at: START });
});

function delivering(answers: Result<{ status: number }, PostFailure>[]) {
  const poster = fakePoster(answers);
  const deliver = createDeliverPushes({ pushes: store, resolver, poster, clock: { now: () => now }, againWaitsMs: AGAIN_WAITS_MS });
  return { poster, deliver: () => deliver(SUPPLIER) };
}

/** Delivers at each moment given, from the start: the push as it stands after. */
async function deliveredAt(deliver: () => Promise<void>, afterStartMs: number[]) {
  for (const ms of afterStartMs) {
    now = new Date(START.getTime() + ms);
    await deliver();
  }
  return store.pushes[0];
}

describe('a push is POSTed to its webhook, with retries and backoff, then given up (slice 4)', () => {
  it('POSTs it with the token and authentication, and keeps it delivered on a 2xx', async () => {
    const { poster, deliver } = delivering([answered(204)]);

    await deliver();

    expect(poster.posted).toEqual([{ url: WEBHOOK, body: 'status:working', token: 'tok-1', authentication: { scheme: 'Bearer', credentials: 'secret-1' } }]);
    expect(store.pushes[0]).toMatchObject({ state: 'delivered', attempts: 1 });
  });

  it.each([
    ['a 500', answered(500)],
    ['a 408', answered(408)],
    ['a 429', answered(429)],
    ['no answer', err({ kind: 'UNREACHABLE' as const, message: 'ECONNREFUSED' })],
  ])('tries again after %s at 1 s, 10 s, 60 s and 300 s, then gives it up after the fifth attempt', async (_kind, answer) => {
    const { poster, deliver } = delivering([answer]);

    const pushed = await deliveredAt(deliver, [0, 999, 1_000, 10_999, 11_000, 71_000, 371_000, 999_999]);

    expect({ posted: poster.posted.length, state: pushed?.state, attempts: pushed?.attempts }).toEqual({ posted: 5, state: 'givenUp', attempts: 5 });
  });

  it('is delivered on a later attempt', async () => {
    const { deliver } = delivering([answered(503), answered(200)]);

    await expect(deliveredAt(deliver, [0, 1_000])).resolves.toMatchObject({ state: 'delivered', attempts: 2 });
  });

  it('is given up at once on a 4xx other than 408 and 429', async () => {
    const { poster, deliver } = delivering([answered(404)]);

    const pushed = await deliveredAt(deliver, [0, 1_000, 100_000]);

    expect({ posted: poster.posted.length, state: pushed?.state }).toEqual({ posted: 1, state: 'givenUp' });
  });

  it('is given up, never POSTed, once its host resolves to a private address', async () => {
    resolver = fakeResolver({ 'hooks.supplier.example': ['10.0.0.5'] });
    const { poster, deliver } = delivering([answered(200)]);

    await deliver();

    expect({ posted: poster.posted, state: store.pushes[0]?.state }).toEqual({ posted: [], state: 'givenUp' });
  });

  it('is given up when the address it connected to was not public', async () => {
    const { deliver } = delivering([err({ kind: 'ADDRESS_REFUSED' as const })]);

    await deliver();

    expect(store.pushes[0]).toMatchObject({ state: 'givenUp', attempts: 1 });
  });

  it("goes in its config's order: a later push waits while an earlier one is tried again", async () => {
    await store.notice(SUPPLIER, { taskId: TASK_ID, id: 'hook-1', mark: 'm2', isFollowing: false, events: ['status:completed'], at: START });
    const { poster, deliver } = delivering([answered(500), answered(200), answered(200)]);

    await deliveredAt(deliver, [0, 500, 1_000, 1_000]);

    expect(poster.posted.map((push) => push.body)).toEqual(['status:working', 'status:working', 'status:completed']);
  });

  it('leaves the task to be read with GetTask once a push was given up', async () => {
    const { deliver } = delivering([answered(400)]);
    await deliver();

    const read = await createReadA2aTask({ calls: await callsWithATask(SUPPLIER), clock: { now: () => now } })(SUPPLIER, TASK_ID);

    expect(read.isOk).toBe(true);
  });
});
