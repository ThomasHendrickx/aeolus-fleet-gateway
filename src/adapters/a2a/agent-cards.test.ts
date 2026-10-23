import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createHttpAgentCards } from './agent-cards.js';

// The gateway reads an outside A2A agent's public card at the address an
// approver typed: the proto's AgentCard as JSON, empty lists left out as
// proto JSON leaves them, and only the fields the gateway uses kept.

/** A card as an agent serves it, its skill listing its tags and an extension the gateway does not read. */
const SERVED_CARD = {
  name: 'Supplier agent',
  description: 'Quotes and books parts.',
  version: '2.1.0',
  supportedInterfaces: [{ url: 'https://agent.supplier.example/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0', tenant: '' }],
  capabilities: { streaming: true },
  securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: 'Bearer' } } },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['application/json'],
  skills: [{ id: 'quote', name: 'Quote a price', description: 'Answers a price for a part list.', tags: ['quotes'], examples: ['Quote 10 bolts'] }],
};

let server: Server;
let base: string;
let answer: { status: number; body: string; headers?: Record<string, string> };

beforeEach(async () => {
  answer = { status: 200, body: JSON.stringify(SERVED_CARD) };
  server = createServer((_request, response) => {
    response.writeHead(answer.status, { 'content-type': 'application/json', ...answer.headers }).end(answer.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${String(z.object({ port: z.number() }).parse(server.address()).port)}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const cards = createHttpAgentCards({ timeoutMs: 2_000 });

describe("the reader of an outside A2A agent's card (slice 5)", () => {
  it('reads the card, keeping its interfaces, description, default modes and skills', async () => {
    await expect(cards.read(`${base}/.well-known/agent-card.json`)).resolves.toEqual({
      isOk: true,
      value: {
        name: 'Supplier agent',
        description: 'Quotes and books parts.',
        supportedInterfaces: [{ url: 'https://agent.supplier.example/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['application/json'],
        isStreaming: true,
        skills: [{ id: 'quote', name: 'Quote a price', description: 'Answers a price for a part list.', inputModes: [], outputModes: [] }],
      },
    });
  });

  it('reads a card that states no streaming as not streaming', async () => {
    answer = { status: 200, body: JSON.stringify({ ...SERVED_CARD, capabilities: {} }) };

    await expect(cards.read(base)).resolves.toMatchObject({ isOk: true, value: { isStreaming: false } });
  });

  it('reads a list left out, as proto JSON leaves an empty one out, as empty', async () => {
    answer = { status: 200, body: JSON.stringify({ ...SERVED_CARD, skills: undefined, defaultOutputModes: undefined }) };

    await expect(cards.read(base)).resolves.toMatchObject({ isOk: true, value: { skills: [], defaultOutputModes: [] } });
  });

  it.each([
    { lacking: 'no name', card: { ...SERVED_CARD, name: undefined }, field: 'name' },
    { lacking: 'no version', card: { ...SERVED_CARD, version: undefined }, field: 'version' },
    { lacking: 'no capabilities', card: { ...SERVED_CARD, capabilities: undefined }, field: 'capabilities' },
    { lacking: 'a skill with no id', card: { ...SERVED_CARD, skills: [{ name: 'Quote', description: 'd' }] }, field: 'skills.0.id' },
  ])('answers no card for an AgentCard with $lacking, naming the field', async ({ card, field }) => {
    answer = { status: 200, body: JSON.stringify(card) };

    const read = await cards.read(base);

    expect(read).toMatchObject({ isOk: false, error: { kind: 'NOT_A_CARD' } });
    expect(read.isOk ? '' : read.error.reason).toContain(field);
  });

  it('answers no card for an answer that is no JSON', async () => {
    answer = { status: 200, body: '<html>hello</html>' };

    await expect(cards.read(base)).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_A_CARD' } });
  });

  it('answers no card for an answer over 1 MB, reading no further', async () => {
    answer = { status: 200, body: JSON.stringify({ ...SERVED_CARD, description: 'x'.repeat(1_100_000) }) };

    const read = await cards.read(base);

    expect(read).toMatchObject({ isOk: false, error: { kind: 'NOT_A_CARD' } });
    expect(read.isOk ? '' : read.error.reason).toContain('1 MB');
  });

  it('answers unreachable for a status other than 2xx, naming it', async () => {
    answer = { status: 404, body: 'not found' };

    const read = await cards.read(base);

    expect(read).toMatchObject({ isOk: false, error: { kind: 'UNREACHABLE' } });
    expect(read.isOk ? '' : read.error.reason).toContain('404');
  });

  it('follows no redirect: the card is read where the approver said, as its domain is the fact written', async () => {
    answer = { status: 302, body: '', headers: { location: 'https://elsewhere.example/card.json' } };

    await expect(cards.read(base)).resolves.toMatchObject({ isOk: false, error: { kind: 'UNREACHABLE' } });
  });

  it('answers unreachable when nothing answers', async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));

    await expect(cards.read(base)).resolves.toMatchObject({ isOk: false, error: { kind: 'UNREACHABLE' } });
    server = createServer();
  });

  it('answers unreachable when the card does not come within the timeout', async () => {
    server.removeAllListeners('request');
    server.on('request', () => undefined);

    await expect(createHttpAgentCards({ timeoutMs: 200 }).read(base)).resolves.toMatchObject({ isOk: false, error: { kind: 'UNREACHABLE' } });
  });
});
