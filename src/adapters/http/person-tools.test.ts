import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';

import { CHARLOTTE_GRANT, SENT_MESSAGE_ID } from '../../../test/support/people-fakes.js';
import type { PersonDiscovery } from '../../core/people/ports.js';
import type { SendMessage } from '../../core/people/send-message.js';
import { err, ok } from '../../core/shared/result.js';
import { personServerFor, type PersonToolsDeps } from './person-tools.js';

// A signed-in person's MCP client starts a message: aeolus_ships says what
// their person ship may send to, and aeolus_send sends as it (aeolus-fleet
// #1046). The tools only translate; the use cases decide.

const DISCOVERY: PersonDiscovery = { ships: [{ name: 'tracker', type: 'issue-tracker', kind: 'app', statement: null }], types: [{ type: 'issue-tracker', reachable: 1 }] };

const unused = () => Promise.reject(new Error('not called in this test'));

/** The person tools over use cases that answer as given, and what aeolus_send was asked. */
function personTools(overrides: Partial<PersonToolsDeps> = {}) {
  const asked: Parameters<SendMessage>[0][] = [];
  const deps: PersonToolsDeps = {
    readInbox: unused,
    openDelivery: unused,
    answerDelivery: unused,
    doneDelivery: unused,
    askForServer: unused,
    listShips: () => Promise.resolve(ok(DISCOVERY)),
    sendMessage: (input) => {
      asked.push(input);
      return Promise.resolve(ok({ messageId: SENT_MESSAGE_ID }));
    },
    ...overrides,
  };
  return { deps, asked };
}

let client: Client | undefined;

afterEach(async () => {
  await client?.close();
});

async function connected(deps: PersonToolsDeps): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await personServerFor(CHARLOTTE_GRANT, deps).connect(serverSide);
  client = new Client({ name: 'charlotte', version: '1' });
  await client.connect(clientSide);
  return client;
}

describe("a person's MCP client starts a message", () => {
  it('is served aeolus_ships and aeolus_send beside the inbox tools', async () => {
    const mcp = await connected(personTools().deps);

    const listed = await mcp.listTools();

    expect(listed.tools.map(({ name }) => name)).toEqual(['aeolus_inbox', 'aeolus_open', 'aeolus_answer', 'aeolus_done', 'aeolus_ships', 'aeolus_send', 'aeolus_ask_for_server']);
  });

  it('reads the ships and types their person ship may send to with aeolus_ships', async () => {
    const mcp = await connected(personTools().deps);

    await expect(mcp.callTool({ name: 'aeolus_ships', arguments: {} })).resolves.toEqual({ content: [{ type: 'text', text: JSON.stringify(DISCOVERY) }] });
  });

  it('sends to a ship by its name with aeolus_send, answering the message id', async () => {
    const { deps, asked } = personTools();
    const mcp = await connected(deps);

    const sent = await mcp.callTool({ name: 'aeolus_send', arguments: { ship: 'tracker', contentType: 'text/plain', payload: 'The build is red', idempotencyKey: 'charlotte-1' } });

    expect({ sent, asked }).toEqual({
      sent: { content: [{ type: 'text', text: JSON.stringify({ messageId: SENT_MESSAGE_ID }) }] },
      asked: [{ caller: CHARLOTTE_GRANT, to: { kind: 'ship', name: 'tracker' }, contentType: 'text/plain', payload: 'The build is red', idempotencyKey: 'charlotte-1' }],
    });
  });

  it('sends to any ship of a type with aeolus_send', async () => {
    const { deps, asked } = personTools();
    const mcp = await connected(deps);

    await mcp.callTool({ name: 'aeolus_send', arguments: { type: 'issue-tracker', contentType: 'text/plain', payload: 'The build is red' } });

    expect(asked).toEqual([{ caller: CHARLOTTE_GRANT, to: { kind: 'type', type: 'issue-tracker' }, contentType: 'text/plain', payload: 'The build is red' }]);
  });

  it.each([
    { what: 'neither a ship nor a type', given: { contentType: 'text/plain', payload: 'Hello' } },
    { what: 'both a ship and a type', given: { ship: 'tracker', type: 'issue-tracker', contentType: 'text/plain', payload: 'Hello' } },
  ])('refuses aeolus_send given $what, sending nothing', async ({ given }) => {
    const { deps, asked } = personTools();
    const mcp = await connected(deps);

    const sent = await mcp.callTool({ name: 'aeolus_send', arguments: given });

    expect({ sent, asked }).toEqual({
      sent: { content: [{ type: 'text', text: 'aeolus_send takes a ship by its name or a type, a contentType and a payload' }], isError: true },
      asked: [],
    });
  });

  it("tells the person the fleet's reason when it refuses the send", async () => {
    const mcp = await connected(personTools({ sendMessage: () => Promise.resolve(err({ kind: 'SEND_REFUSED', message: 'The fleet did not take your message: No active ship is named nobody' })) }).deps);

    await expect(mcp.callTool({ name: 'aeolus_send', arguments: { ship: 'nobody', contentType: 'text/plain', payload: 'Hello' } })).resolves.toEqual({
      content: [{ type: 'text', text: 'The fleet did not take your message: No active ship is named nobody' }],
      isError: true,
    });
  });
});
