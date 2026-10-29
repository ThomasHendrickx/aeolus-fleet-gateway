import { beforeEach, describe, expect, it } from 'vitest';

import { fakeConfigIds, fakeResolver, memoryPushStore } from '../../../test/support/a2a-push-fakes.js';
import { callsWithATask, TASK_ID, TASK_SENT_AT } from '../../../test/support/a2a-task-fakes.js';
import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { createSetPushConfig } from './set-push-config.js';

const SUPPLIER = { fleetId: FLEET_ID, party: 'supplier' };
const NOW = new Date('2026-10-23T12:01:00.000Z');
const WEBHOOK = 'https://hooks.supplier.example/a2a';

let store: ReturnType<typeof memoryPushStore>;
let set: ReturnType<typeof createSetPushConfig>;

beforeEach(async () => {
  store = memoryPushStore();
  set = createSetPushConfig({
    calls: await callsWithATask(SUPPLIER),
    configs: store,
    resolver: fakeResolver({ 'hooks.supplier.example': ['93.184.215.14'], 'inside.supplier.example': ['10.0.0.5'], 'split.supplier.example': ['93.184.215.14', '127.0.0.1'] }),
    ids: fakeConfigIds(),
    clock: { now: () => NOW },
  });
});

const setting = (config: { url?: string; id?: string; taskId?: string; token?: string | null }, caller = SUPPLIER) =>
  set({ caller, config: { taskId: TASK_ID, url: WEBHOOK, token: null, authentication: null, ...config } });

describe("an A2A client sets a push config on its own task (slice 4)", () => {
  it('keeps it with its token and authentication, followed from the task as it stands, and answers it without them', async () => {
    const answered = await set({ caller: SUPPLIER, config: { taskId: TASK_ID, id: 'hook-1', url: WEBHOOK, token: 'tok-1', authentication: { scheme: 'Bearer', credentials: 'secret-1' } } });

    expect(answered).toEqual({ isOk: true, value: { taskId: TASK_ID, id: 'hook-1', url: WEBHOOK } });
    expect(store.configs).toEqual([
      { ...SUPPLIER, taskId: TASK_ID, id: 'hook-1', url: WEBHOOK, token: 'tok-1', authentication: { scheme: 'Bearer', credentials: 'secret-1' }, createdAt: NOW, noticedMark: `submitted:${String(TASK_SENT_AT.getTime())}:1`, isFollowing: true },
    ]);
  });

  it('gives it an id when the client names none', async () => {
    await expect(setting({})).resolves.toMatchObject({ isOk: true, value: { id: 'config-1' } });
  });

  it('keeps one config per task and id, the latest set', async () => {
    await setting({ id: 'hook-1', token: 'old' });
    await setting({ id: 'hook-1', token: 'new' });

    expect(store.configs.map((config) => config.token)).toEqual(['new']);
  });

  it("refuses an unknown task, or another party's, as not found, keeping nothing", async () => {
    const [unknown, others] = [await setting({ taskId: 'task-9' }), await setting({}, { fleetId: FLEET_ID, party: 'claude' })];

    expect([unknown, others]).toMatchObject([
      { isOk: false, error: { kind: 'TASK_NOT_FOUND' } },
      { isOk: false, error: { kind: 'TASK_NOT_FOUND' } },
    ]);
    expect(store.configs).toEqual([]);
  });

  it.each([
    ['an http URL', 'http://hooks.supplier.example/a2a'],
    ['a private address', 'https://10.0.0.5/a2a'],
    ['a loopback IPv6 address', 'https://[::1]/a2a'],
    ['cloud metadata', 'https://169.254.169.254/latest'],
    ['a name that resolves to a private address', 'https://inside.supplier.example/a2a'],
    ['a name that resolves to a public and a loopback address', 'https://split.supplier.example/a2a'],
    ['a name that resolves to nothing', 'https://nowhere.supplier.example/a2a'],
  ])('refuses %s, keeping nothing', async (_kind, url) => {
    await expect(setting({ url })).resolves.toMatchObject({ isOk: false, error: { kind: 'WEBHOOK_REFUSED' } });
    expect(store.configs).toEqual([]);
  });
});
