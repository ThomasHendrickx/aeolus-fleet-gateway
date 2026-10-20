import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { isCreateTaskResultV2 } from '@modelcontextprotocol/ext-tasks/core/v2';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { commission, register, signIn } from './support/argo.js';
import { receiveOne } from './support/ship.js';
import { setTimeout as wait } from 'node:timers/promises';
import { migratedDatabase } from './support/database.js';
import { PAGASAE_CLIENT, startFakePagasae } from './support/fake-pagasae.js';
import { aFreePort, startFleetServer } from './support/fleet-server.js';
import { aConnectedGateway, aSignedInClient, TEST_GATEWAY_SECRET, type Setting } from './support/mcp-client.js';
import { mutate } from './support/gateway-api.js';

// MCP in (interop 3.3): an outside MCP client, signed in, sees the
// capabilities of the ships its party reaches as tools, named by alias.

/** How long a call waits for its answer in these tests: long enough for a ship's reply to travel, short for the calls nobody answers. */
const MCP_WAIT_MS = 3000;

let setting: Setting;
let app: GatewayApp;

beforeEach(async () => {
  const fleet = await startFleetServer(inject('postgresUrl'));
  const port = await aFreePort();
  const address = `http://127.0.0.1:${String(port)}`;
  setting = { fleet, address, cookie: await signIn(fleet), databaseUrl: await migratedDatabase(inject('postgresUrl')), pagasae: await startFakePagasae() };
  app = createGatewayApp({ databaseUrl: setting.databaseUrl, fleetUrl: fleet.url, logger: false, publicUrl: address, gatewaySecret: TEST_GATEWAY_SECRET, pagasae: { url: setting.pagasae.url, ...PAGASAE_CLIENT }, mcpWaitMaxMs: MCP_WAIT_MS });
  await app.server.listen({ host: '127.0.0.1', port });
  await aConnectedGateway(setting);
});

afterEach(async () => {
  await app.close();
  await setting.pagasae.stop();
  await setting.fleet.stop();
});

/** A ship of the fleet that states one capability, as its crew: its crew token. */
async function aStatingShip(): Promise<string> {
  const ship = await commission(setting.fleet, { cookie: setting.cookie, ship: { name: 'crm', type: 'crm', kind: 'app' } });
  const crewToken = await register(setting.fleet, ship);
  const response = await fetch(`${setting.fleet.url}/api/v1/ship/setStatement`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${crewToken}` },
    body: JSON.stringify({
      summary: 'The CRM: contacts and deals.',
      capabilities: [{ name: 'list_deals', description: "Lists a contact's deals.", inputSchema: { type: 'object', properties: { contactId: { type: 'string' } } }, inputModes: ['application/json'] }],
    }),
  });
  expect(response.status).toBe(200);
  return crewToken;
}

/** The SDK client of a signed-in MCP client, connected to the gateway's MCP endpoint. */
async function aConnectedClient(): Promise<Client> {
  const client = await aSignedInClient(setting);
  const mcp = new Client({ name: 'test-client', version: '1' });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`${setting.address}/mcp`), { authProvider: client.provider }));
  return mcp;
}

/** How often, and how many times, a test reads a call while its reply travels. */
const REPLY_POLL_MS = 500;
const REPLY_ATTEMPTS = 60;

/** The ship replies to a message, as its crew, in plain text. */
async function replyTo(crewToken: string, reply: { to: string; inReplyTo: string; payload: string }): Promise<void> {
  const response = await fetch(`${setting.fleet.url}/api/v1/ship/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${crewToken}` },
    body: JSON.stringify({ selector: { kind: 'ship', shipId: reply.to }, inReplyTo: reply.inReplyTo, contentType: 'text/plain', payload: reply.payload, idempotencyKey: crypto.randomUUID() }),
  });
  expect(response.status).toBe(200);
}

const textOf = (result: Awaited<ReturnType<Client['callTool']>>) => z.string().parse(z.array(z.object({ text: z.string() })).parse(result.content)[0]?.text);

describe('an outside MCP client lists the tools of the ships its party reaches', () => {
  it("lists a ship's capability as a tool named by alias, never by the ship's name", async () => {
    await aStatingShip();
    const client = await aSignedInClient(setting);
    const mcp = new Client({ name: 'test-client', version: '1' });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`${setting.address}/mcp`), { authProvider: client.provider }));

    const { tools } = await mcp.listTools();
    await mcp.close();

    expect(tools.map((tool) => [/^[a-z][a-z0-9]{7}__list_deals$/.test(tool.name) || tool.name === 'aeolus_result', tool.description?.split('\n\n')[1] ?? tool.name])).toEqual([
      [true, 'Offered by: The CRM: contacts and deals.'],
      [true, 'aeolus_result'],
    ]);
    expect(JSON.stringify(tools)).not.toContain('crm"');
  });

  it("refuses an outside client once argo turns the fleet's outside parties off (interop I-3)", async () => {
    const mcp = await aConnectedClient();
    await mcp.close();

    const off = await mutate(setting.address, { procedure: 'outsideParties.set', cookie: setting.cookie, body: { isOn: false, isOpenNetworkConfirmed: false } });
    expect(off.status, await off.clone().text()).toBe(200);

    await expect(aConnectedClient()).rejects.toThrow();
  });

  it('answers 401 with where to sign in to a call without a token (RFC 9728)', async () => {
    const response = await fetch(`${setting.address}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });

    expect({ status: response.status, challenge: response.headers.get('www-authenticate') }).toEqual({
      status: 401,
      challenge: `Bearer resource_metadata="${setting.address}/.well-known/oauth-protected-resource/mcp"`,
    });
  });

  it('answers 401 invalid_token to a token it did not issue', async () => {
    const response = await fetch(`${setting.address}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer not-a-token' }, body: '{}' });

    expect({ status: response.status, challenge: response.headers.get('www-authenticate') }).toEqual({
      status: 401,
      challenge: `Bearer error="invalid_token", resource_metadata="${setting.address}/.well-known/oauth-protected-resource/mcp"`,
    });
  });
});

describe("an outside MCP client's tool call is a message its proxy ship sends", () => {
  it("delivers the call's arguments to the ship, and answers a handle aeolus_result reads", async () => {
    const crm = await aStatingShip();
    const mcp = await aConnectedClient();
    const [tool] = (await mcp.listTools()).tools.filter((each) => each.name.endsWith('__list_deals'));

    const called = await mcp.callTool({ name: z.string().parse(tool?.name), arguments: { contactId: 'c1' } });
    const { handle } = z.object({ handle: z.string() }).parse(JSON.parse(textOf(called)));
    const read = await mcp.callTool({ name: 'aeolus_result', arguments: { handle } });
    await mcp.close();

    expect(await receiveOne(setting.fleet, crm)).toMatchObject({ contentType: 'application/json', payload: '{"contactId":"c1"}' });
    expect(JSON.parse(textOf(read))).toEqual({ handle, state: 'submitted' });
  });

  it("answers aeolus_result with the ship's reply once it came: plain text from a ship that states no output type", async () => {
    const crm = await aStatingShip();
    const mcp = await aConnectedClient();
    const [tool] = (await mcp.listTools()).tools.filter((each) => each.name.endsWith('__list_deals'));
    const { handle } = z.object({ handle: z.string() }).parse(JSON.parse(textOf(await mcp.callTool({ name: z.string().parse(tool?.name), arguments: { contactId: 'c1' } }))));
    const delivery = await receiveOne(setting.fleet, crm);
    await replyTo(crm, { to: z.string().parse(delivery?.senderShipId), inReplyTo: z.string().parse(delivery?.messageId), payload: 'Two deals: Analytical engine, Difference engine.' });

    let read = await mcp.callTool({ name: 'aeolus_result', arguments: { handle } });
    for (let attempt = 0; attempt < REPLY_ATTEMPTS && read.content.length > 0 && textOf(read).includes('"state":"submitted"'); attempt += 1) {
      await wait(REPLY_POLL_MS);
      read = await mcp.callTool({ name: 'aeolus_result', arguments: { handle } });
    }
    await mcp.close();

    expect({ text: textOf(read), isError: read.isError }).toEqual({ text: 'Two deals: Analytical engine, Difference engine.', isError: undefined });
  });

  it("answers the ship's reply itself when it comes within the wait", async () => {
    const crm = await aStatingShip();
    const mcp = await aConnectedClient();
    const [tool] = (await mcp.listTools()).tools.filter((each) => each.name.endsWith('__list_deals'));

    const calling = mcp.callTool({ name: z.string().parse(tool?.name), arguments: { contactId: 'c1' } });
    const delivery = await receiveOne(setting.fleet, crm);
    await replyTo(crm, { to: z.string().parse(delivery?.senderShipId), inReplyTo: z.string().parse(delivery?.messageId), payload: 'One deal: Analytical engine.' });
    const called = await calling;
    await mcp.close();

    expect(textOf(called)).toBe('One deal: Analytical engine.');
  });

  it('sends the same call under the same idempotency argument once', async () => {
    const crm = await aStatingShip();
    const mcp = await aConnectedClient();
    const [tool] = (await mcp.listTools()).tools.filter((each) => each.name.endsWith('__list_deals'));
    const call = { name: z.string().parse(tool?.name), arguments: { contactId: 'c1', aeolus_idempotency_key: 'k-1' } };

    const handles = [textOf(await mcp.callTool(call)), textOf(await mcp.callTool(call))];
    await mcp.close();

    expect(handles[0]).toBe(handles[1]);
    expect(await receiveOne(setting.fleet, crm)).toBeDefined();
    const inbox = await fetch(`${setting.fleet.url}/api/v1/ship/inbox`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${crm}` }, body: '{}' });
    expect(z.object({ waiting: z.number() }).parse(await inbox.json()).waiting).toBe(0);
  });

  it('answers a tool error, sending nothing, for a tool it does not list', async () => {
    const mcp = await aConnectedClient();

    const called = await mcp.callTool({ name: 'aaaaaaaa__drop_tables', arguments: {} });
    await mcp.close();

    expect(called.isError).toBe(true);
  });
});

/** MCP's per-request envelope (2026-07-28) of a client that declares the Tasks extension. */
const TASKS_CLIENT_META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'test-client', version: '1' },
  'io.modelcontextprotocol/clientCapabilities': { extensions: { 'io.modelcontextprotocol/tasks': {} } },
};

const rpcAnswer = z.object({ result: z.record(z.string(), z.unknown()).optional(), error: z.object({ code: z.number(), message: z.string() }).optional() });

/** One request to the gateway's MCP endpoint over Streamable HTTP, as a client that declares the Tasks extension sends it: its result or error. */
async function rpc(accessToken: string, request: { method: string; params: Record<string, unknown>; name?: string }) {
  const response = await fetch(`${setting.address}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${accessToken}`,
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': request.method,
      ...(request.name === undefined ? {} : { 'mcp-name': request.name }),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: request.method, params: { ...request.params, _meta: TASKS_CLIENT_META } }),
  });
  return rpcAnswer.parse(await response.json());
}

/** A signed-in client's access token, and the name it lists the CRM's tool under. */
async function aTasksClient(): Promise<{ accessToken: string; tool: string }> {
  const client = await aSignedInClient(setting);
  const accessToken = z.string().parse(client.tokens()?.access_token);
  const listed = await rpc(accessToken, { method: 'tools/list', params: {} });
  const tools = z.object({ tools: z.array(z.object({ name: z.string() })) }).parse(listed.result).tools;
  return { accessToken, tool: z.string().parse(tools.find((each) => each.name.endsWith('__list_deals'))?.name) };
}

const taskIdOf = (result: unknown) => z.object({ taskId: z.string() }).parse(result).taskId;

describe('an outside MCP client that declares the Tasks extension follows a long call as a task', () => {
  it('finds the extension stated at server/discover', async () => {
    const client = await aSignedInClient(setting);

    const discovered = await rpc(z.string().parse(client.tokens()?.access_token), { method: 'server/discover', params: {} });

    expect(discovered.result).toMatchObject({ capabilities: { extensions: { 'io.modelcontextprotocol/tasks': {} } } });
  });

  it('is answered a task, durably created, for a call its ship does not answer within the wait', async () => {
    await aStatingShip();
    const { accessToken, tool } = await aTasksClient();

    const created = await rpc(accessToken, { method: 'tools/call', params: { name: tool, arguments: { contactId: 'c1' } }, name: tool });
    const taskId = taskIdOf(created.result);
    const read = await rpc(accessToken, { method: 'tasks/get', params: { taskId }, name: taskId });

    expect(isCreateTaskResultV2(created.result)).toBe(true);
    expect(read.result).toMatchObject({ taskId, status: 'working' });
  });

  it("reads the task completed with the ship's reply as its result", async () => {
    const crm = await aStatingShip();
    const { accessToken, tool } = await aTasksClient();
    const taskId = taskIdOf((await rpc(accessToken, { method: 'tools/call', params: { name: tool, arguments: { contactId: 'c1' } }, name: tool })).result);
    const delivery = await receiveOne(setting.fleet, crm);
    await replyTo(crm, { to: z.string().parse(delivery?.senderShipId), inReplyTo: z.string().parse(delivery?.messageId), payload: 'Two deals: Analytical engine, Difference engine.' });

    let read = await rpc(accessToken, { method: 'tasks/get', params: { taskId }, name: taskId });
    for (let attempt = 0; attempt < REPLY_ATTEMPTS && read.result?.status === 'working'; attempt += 1) {
      await wait(REPLY_POLL_MS);
      read = await rpc(accessToken, { method: 'tasks/get', params: { taskId }, name: taskId });
    }

    expect(read.result).toMatchObject({ taskId, status: 'completed', result: { content: [{ type: 'text', text: 'Two deals: Analytical engine, Difference engine.' }] } });
  });

  it.each([
    { what: 'tasks/cancel', method: 'tasks/cancel', params: {} },
    { what: 'tasks/update', method: 'tasks/update', params: { inputResponses: {} } },
  ])('is acknowledged its $what, and the task goes on: a sent call cannot be unsent', async ({ method, params }) => {
    await aStatingShip();
    const { accessToken, tool } = await aTasksClient();
    const taskId = taskIdOf((await rpc(accessToken, { method: 'tools/call', params: { name: tool, arguments: { contactId: 'c1' } }, name: tool })).result);

    const acknowledged = await rpc(accessToken, { method, params: { taskId, ...params }, name: taskId });
    const read = await rpc(accessToken, { method: 'tasks/get', params: { taskId }, name: taskId });

    expect(acknowledged.error).toBeUndefined();
    expect(acknowledged.result).toMatchObject({ resultType: 'complete' });
    expect(read.result).toMatchObject({ taskId, status: 'working' });
  });

  it.each(['tasks/cancel', 'tasks/update'])('is answered an error for %s of a task it never got', async (method) => {
    const client = await aSignedInClient(setting);

    const answered = await rpc(z.string().parse(client.tokens()?.access_token), { method, params: { taskId: 'not-a-task', inputResponses: {} }, name: 'not-a-task' });

    expect(answered.error).toMatchObject({ code: -32602 });
  });

  it('is answered an error for a task it never got', async () => {
    const client = await aSignedInClient(setting);

    const read = await rpc(z.string().parse(client.tokens()?.access_token), { method: 'tasks/get', params: { taskId: 'not-a-task' }, name: 'not-a-task' });

    expect(read.error).toMatchObject({ code: -32602 });
  });
});
