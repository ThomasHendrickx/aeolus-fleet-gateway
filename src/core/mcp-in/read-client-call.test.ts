import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { CRM_SHIP_ID, MESSAGE_ID, memoryClientCalls } from '../../../test/support/mcp-in-fakes.js';
import { createReadClientCall } from './read-client-call.js';

const HANDLE = 'handle-1';

let calls: ReturnType<typeof memoryClientCalls>;
let readClientCall: ReturnType<typeof createReadClientCall>;

beforeEach(async () => {
  calls = memoryClientCalls();
  await calls.save({ fleetId: FLEET_ID, party: 'claude', messageId: MESSAGE_ID, handle: HANDLE, shipId: CRM_SHIP_ID, capability: 'list_deals', sentAt: new Date('2026-10-19T12:00:00.000Z') });
  readClientCall = createReadClientCall({ calls });
});

describe('an outside MCP client reads its call by the handle it was answered (interop 3.4)', () => {
  it('reads a call sent and not yet answered as submitted', async () => {
    await expect(readClientCall({ fleetId: FLEET_ID, party: 'claude' }, HANDLE)).resolves.toEqual({ isOk: true, value: { handle: HANDLE, state: 'submitted' } });
  });

  it.each([
    { what: 'a handle it was never answered', caller: { fleetId: FLEET_ID, party: 'claude' }, handle: 'handle-2' },
    { what: "another party's call", caller: { fleetId: FLEET_ID, party: 'cursor' }, handle: HANDLE },
    { what: "another fleet's call", caller: { fleetId: OTHER_FLEET_ID, party: 'claude' }, handle: HANDLE },
  ])('knows no call by $what', async ({ caller, handle }) => {
    await expect(readClientCall(caller, handle)).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_CALL' } });
  });
});
