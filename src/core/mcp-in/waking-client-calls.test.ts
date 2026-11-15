import { expect, it } from 'vitest';

import { aClientCall, memoryClientCalls } from '../../../test/support/mcp-in-fakes.js';
import { createWakingClientCalls } from './waking-client-calls.js';

it('requests a reply look only after the new call is durably stored', async () => {
  const store = memoryClientCalls();
  const found: string[] = [];
  const calls = createWakingClientCalls(store, async (call) => {
    const saved = await store.findByMessage(call.fleetId, call.messageId);
    if (saved !== undefined) { found.push(saved.messageId); }
  });
  await calls.save(aClientCall());
  expect(found).toEqual([aClientCall().messageId]);
});

it('does not request a reply look when storing the call fails', async () => {
  const store = memoryClientCalls();
  store.save = () => Promise.reject(new Error('database down'));
  const found: string[] = [];
  const calls = createWakingClientCalls(store, (call) => { found.push(call.messageId); return Promise.resolve(); });
  await calls.save(aClientCall()).catch(() => undefined);
  expect(found).toEqual([]);
});
