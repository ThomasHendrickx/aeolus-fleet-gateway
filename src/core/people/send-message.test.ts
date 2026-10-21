import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { CHARLOTTE_GRANT, SENT_MESSAGE_ID, fakeCrewPersonShip, fakePersonShipDoor, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import { createSendMessage } from './send-message.js';

// A person starts a message from their MCP client, as their person ship: to
// one ship by its name, or any ship of a type. The fleet decides whether it
// may go, and its refusal tells the person why (aeolus-fleet #1046).

const QUESTION = {
  contentType: 'application/vnd.aeolus.question+json',
  payload: '{"id":"0b6f2a52-6a43-4a43-9a43-3f3c3b9b1a10","title":"Which release?","options":[{"key":1,"label":"1.4"},{"key":2,"label":"1.5"}]}',
};

let crews: ReturnType<typeof memoryPersonCrews>;

beforeEach(() => {
  crews = memoryPersonCrews();
});

function sending() {
  const ship = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries: [] });
  const sendMessage = createSendMessage({ crewPersonShip: fakeCrewPersonShip(crews), crews, door: ship.door, keys: { newIdempotencyKey: () => 'a-new-key' } });
  return { ...ship, sendMessage };
}

describe('a person sends a message as their person ship', () => {
  it("sends it to a ship by its name under the person's own key, answering the message's id", async () => {
    const { sendMessage, sent } = sending();

    const answered = await sendMessage({ caller: CHARLOTTE_GRANT, to: { kind: 'ship', name: 'tracker' }, ...QUESTION, idempotencyKey: 'charlotte-1' });

    expect({ answered, sent }).toEqual({
      answered: { isOk: true, value: { messageId: SENT_MESSAGE_ID } },
      sent: [{ to: { kind: 'ship', name: 'tracker' }, ...QUESTION, idempotencyKey: 'charlotte-1' }],
    });
  });

  it('sends it to any ship of a type', async () => {
    const { sendMessage, sent } = sending();

    await sendMessage({ caller: CHARLOTTE_GRANT, to: { kind: 'type', type: 'issue-tracker' }, contentType: 'text/plain', payload: 'The build is red', idempotencyKey: 'charlotte-2' });

    expect(sent.map(({ to }) => to)).toEqual([{ kind: 'type', type: 'issue-tracker' }]);
  });

  it('sends it under a new key when the person gives none', async () => {
    const { sendMessage, sent } = sending();

    await sendMessage({ caller: CHARLOTTE_GRANT, to: { kind: 'ship', name: 'tracker' }, contentType: 'text/plain', payload: 'Hello' });

    expect(sent.map(({ idempotencyKey }) => idempotencyKey)).toEqual(['a-new-key']);
  });

  it.each([
    ['no ship has the name', 'No active ship is named nobody'],
    ['the network rules do not allow it', 'The network rules do not allow this send'],
    ['the payload is over 64 KB', 'A payload is at most 65536 bytes (64 KB) in UTF-8'],
  ])('tells the person why the fleet refused it when %s', async (_, reason) => {
    const { sendMessage, refusals } = sending();
    refusals.send.push({ code: 'BAD_REQUEST', message: reason });

    await expect(sendMessage({ caller: CHARLOTTE_GRANT, to: { kind: 'ship', name: 'tracker' }, contentType: 'text/plain', payload: 'Hello' })).resolves.toEqual({
      isOk: false,
      error: { kind: 'SEND_REFUSED', message: `The fleet did not take your message: ${reason}` },
    });
  });

  it('refuses an account with no person ship, sending nothing', async () => {
    const { sendMessage, calls } = sending();

    await expect(sendMessage({ caller: { fleetId: FLEET_ID, grantId: 'grant-2' }, to: { kind: 'ship', name: 'tracker' }, contentType: 'text/plain', payload: 'Hello' })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'NOT_A_PERSON' },
    });
    expect(calls).toEqual([]);
  });
});
