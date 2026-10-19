import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aCallReply, aClientCall, MESSAGE_ID, memoryClientCalls } from '../../../test/support/mcp-in-fakes.js';
import type { Clock } from '../shared/clock.js';
import { createReadClientCall } from './read-client-call.js';

const HANDLE = 'handle-1';
const CALLER = { fleetId: FLEET_ID, party: 'claude' };

let calls: ReturnType<typeof memoryClientCalls>;
let now: Date;
let readClientCall: ReturnType<typeof createReadClientCall>;

beforeEach(async () => {
  calls = memoryClientCalls();
  await calls.save(aClientCall({ handle: HANDLE, deadlineAt: new Date('2026-10-19T12:10:00.000Z') }));
  now = new Date('2026-10-19T12:01:00.000Z');
  const clock: Clock = { now: () => now };
  readClientCall = createReadClientCall({ calls, clock });
});

/** When aClientCall was sent. */
const SENT_AT = new Date('2026-10-19T12:00:00.000Z');

describe('an outside MCP client reads its call by the handle it was answered (interop 3.4)', () => {
  it('reads a call sent and not yet answered as submitted, since it was sent', async () => {
    await expect(readClientCall(CALLER, HANDLE)).resolves.toEqual({ isOk: true, value: { handle: HANDLE, createdAt: SENT_AT, updatedAt: SENT_AT, state: 'submitted' } });
  });

  it('reads a completed call with its answer, since it came', async () => {
    await calls.addReply({ fleetId: FLEET_ID, messageId: MESSAGE_ID }, aCallReply({ contentType: 'text/plain', payload: 'Two deals.' }));

    await expect(readClientCall(CALLER, HANDLE)).resolves.toEqual({ isOk: true, value: { handle: HANDLE, createdAt: SENT_AT, updatedAt: new Date('2026-10-19T12:01:00.000Z'), state: 'completed', answer: { contentType: 'text/plain', payload: 'Two deals.' } } });
  });

  it('reads a call past its deadline with no answer as failed, since its deadline', async () => {
    now = new Date('2026-10-19T12:10:00.000Z');

    await expect(readClientCall(CALLER, HANDLE)).resolves.toEqual({ isOk: true, value: { handle: HANDLE, createdAt: SENT_AT, updatedAt: new Date('2026-10-19T12:10:00.000Z'), state: 'failed' } });
  });

  it.each([
    { what: 'a handle it was never answered', caller: CALLER, handle: 'handle-2' },
    { what: "another party's call", caller: { fleetId: FLEET_ID, party: 'cursor' }, handle: HANDLE },
    { what: "another fleet's call", caller: { fleetId: OTHER_FLEET_ID, party: 'claude' }, handle: HANDLE },
  ])('knows no call by $what', async ({ caller, handle }) => {
    await expect(readClientCall(caller, handle)).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_CALL' } });
  });
});
