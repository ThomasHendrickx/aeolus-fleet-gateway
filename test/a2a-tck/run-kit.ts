/**
 * Runs the A2A TCK (github.com/a2aproject/a2a-tck) against the gateway's A2A
 * in, by hand and not in CI: `npx tsx test/a2a-tck/run-kit.ts <kit folder>`,
 * with the kit installed in its own `.venv` as its README says. Extra
 * arguments go to the kit's `run_tck.py`; its reports land in its
 * `reports/` folder.
 *
 * The fleet and the gateway are real, on a Postgres of their own. The kit
 * knows nothing of a bearer, and picks what the agent does by the prefix of
 * each messageId, so two test-only parts stand between them:
 * - a proxy on the kit's side, serving the alias's card at its root and
 *   passing every call on with the supplier's bearer, without the "/" the
 *   kit's JSON-RPC client puts after the interface's URL;
 * - a test ship behind the alias, acting out the kit's scenarios
 *   (`scenarios/*.feature`) as far as a ship's reply can. A message of one
 *   text part reaches it as that text alone, so the proxy notes each sent
 *   message's text and scenario for the ship to read back.
 */
import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';

import { idSchema, type ShipId } from '@aeolus-fleet/common';
import { z } from 'zod';

import { createShipAliases } from '../../src/adapters/crypto/ship-aliases.js';
import { createGatewayApp } from '../../src/app.js';
import { commission, register, signIn } from '../support/argo.js';
import { POSTGRES_IMAGE, REAPER_IMAGE } from '../support/container-images.js';
import { migratedDatabase } from '../support/database.js';
import { aFreePort, startFleetServer, type FleetServer } from '../support/fleet-server.js';
import { connectGateway, mutate } from '../support/gateway-api.js';
import { outsidePartiesOn } from '../support/outside-parties.js';
import { TestPostgres } from '../support/postgres-container.js';

const GATEWAY_SECRET = 'a-kit-gateway-secret-of-at-least-32-characters';
const GATEWAY_SCOPES = ['fleet:read', 'fleet:commission', 'fleet:on-behalf', 'scopes:declare', 'fleet:verify'];
/** The port the kit calls, as its README's examples do. */
const PROXY_PORT = 9999;
/** A blocking send waits at most this long: well past the test ship's answer. */
const WAIT_MAX_MS = 10_000;

const kitFolder = process.argv[2];
if (kitFolder === undefined) {
  throw new Error('Usage: npx tsx test/a2a-tck/run-kit.ts <a2a-tck folder> [run_tck.py arguments]');
}

/** A call to the fleet as a crew: its answer. */
async function asCrew(fleet: FleetServer, call: { crewToken: string; path: string; body: unknown }): Promise<unknown> {
  const response = await fetch(`${fleet.url}/api/v1${call.path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${call.crewToken}` }, body: JSON.stringify(call.body) });
  if (!response.ok) {
    throw new Error(`${call.path} failed: ${await response.text()}`);
  }
  return response.json();
}

/** The text and scenario of each message the kit sent, in the order sent. */
const sentScenarios: { text: string; scenario: string }[] = [];

/** The scenario a messageId names: `tck-<scenario>-<session>`, or `tck-<scenario>-<session>-<n>`, before any `~<n>` the proxy added. */
function scenarioOf(messageId: string): string {
  return /^tck-(?<scenario>.+?)-[0-9a-f]{6,}(?:-\d+)?(?:~\d+)?$/.exec(messageId)?.groups?.scenario ?? messageId;
}

const kitMessageSchema = z.object({ messageId: z.string(), parts: z.array(z.object({ text: z.string().optional() }).loose()) }).loose();
const rpcSendSchema = z.object({ method: z.literal('SendMessage'), params: z.object({ message: kitMessageSchema }).loose() }).loose();
const restSendSchema = z.object({ message: kitMessageSchema }).loose();

/**
 * With KIT_UNIQUE_MESSAGE_IDS=1, each sent messageId gets `~<n>`: the kit
 * sends one messageId per scenario for every test, and the gateway sends a
 * messageId once, as the send's idempotency key.
 */
const isUniquingIds = process.env.KIT_UNIQUE_MESSAGE_IDS === '1';
let sentCount = 0;

/** The message as passed on, with its messageId made unique when asked. */
function passedOn(message: z.infer<typeof kitMessageSchema>): z.infer<typeof kitMessageSchema> {
  const [only, ...more] = message.parts;
  if (only?.text !== undefined && more.length === 0) {
    sentScenarios.push({ text: only.text, scenario: scenarioOf(message.messageId) });
  }
  sentCount += 1;
  return isUniquingIds ? { ...message, messageId: `${message.messageId}~${String(sentCount)}` } : message;
}

/** The body passed on: a sent message is noted with its text and scenario. */
function bodyPassedOn(body: string): string {
  try {
    const json: unknown = JSON.parse(body);
    const rpc = rpcSendSchema.safeParse(json);
    if (rpc.success) {
      return JSON.stringify({ ...rpc.data, params: { ...rpc.data.params, message: passedOn(rpc.data.params.message) } });
    }
    const rest = restSendSchema.safeParse(json);
    if (rest.success) {
      return JSON.stringify({ ...rest.data, message: passedOn(rest.data.message) });
    }
  } catch {
    // Not JSON: the gateway answers it, and no ship sees it.
  }
  return body;
}

/** The scenario of a delivery: read from the whole message, or the latest noted one of its text. */
function scenarioFor(contentType: string, payload: string): string {
  if (contentType.startsWith('application/a2a+json')) {
    return scenarioOf(z.object({ messageId: z.string() }).loose().parse(JSON.parse(payload)).messageId);
  }
  // The latest of its text: an earlier one the fleet refused, or sent once already, reached no ship.
  const at = sentScenarios.findLastIndex((sent) => sent.text === payload);
  return at < 0 ? 'complete-task' : (sentScenarios.splice(0, at + 1).at(-1)?.scenario ?? 'complete-task');
}

/** The reply a scenario gives, as the kit's `core_operations.feature` says, as far as a ship's reply can say it. */
function replyOf(scenario: string): { contentType: string; payload: string } {
  const text = (payload: string) => ({ contentType: 'text/plain', payload });
  const carried = (state: string, said: string) => ({
    contentType: 'application/a2a+json',
    payload: JSON.stringify({ statusUpdate: { taskId: '', contextId: '', status: { state, message: { messageId: crypto.randomUUID(), role: 'ROLE_AGENT', parts: [{ text: said }] } } } }),
  });
  if (scenario.startsWith('artifact-text')) {
    return text('Generated text content');
  }
  if (scenario.startsWith('artifact-data')) {
    return { contentType: 'application/json', payload: JSON.stringify({ key: 'value', count: 42 }) };
  }
  if (scenario.startsWith('artifact-file')) {
    // A file part has no reply of its own: the ship answers its content.
    return text('output.txt');
  }
  if (scenario.startsWith('message-response')) {
    return text('Direct message response');
  }
  if (scenario.startsWith('input-required')) {
    return {
      contentType: 'application/vnd.aeolus.question+json',
      payload: JSON.stringify({ id: crypto.randomUUID(), title: 'More input', context: 'The kit asks for input.', options: [{ key: 1, label: 'Go on', detail: 'Go on' }], pick: { option: 1, why: 'The kit goes on.' } }),
    };
  }
  if (scenario.startsWith('reject-task')) {
    return carried('TASK_STATE_REJECTED', 'rejected');
  }
  return text('Hello from TCK');
}

const deliverySchema = z.object({ deliveryId: z.string(), messageId: z.string(), senderShipId: z.string(), contentType: z.string(), payload: z.string() });

/** The test ship: receives, acknowledges and answers each delivery as its scenario says, until stopped. */
async function actOutScenarios(ship: { fleet: FleetServer; crewToken: string }, isStopped: () => boolean): Promise<void> {
  const { fleet, crewToken } = ship;
  while (!isStopped()) {
    const [delivery] = z.object({ deliveries: z.array(deliverySchema) }).parse(await asCrew(fleet, { crewToken, path: '/ship/receive', body: {} })).deliveries;
    if (delivery !== undefined) {
      await asCrew(fleet, { crewToken, path: '/ship/ack', body: { deliveryId: delivery.deliveryId } });
      const reply = replyOf(scenarioFor(delivery.contentType, delivery.payload));
      const body = { selector: { kind: 'ship', shipId: delivery.senderShipId }, inReplyTo: delivery.messageId, ...reply, idempotencyKey: crypto.randomUUID() };
      await asCrew(fleet, { crewToken, path: '/ship/send', body });
    }
  }
}

async function bodyOf(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks);
}

/** The proxy: the alias's card at its root, its interface on this origin, every call passed on with the bearer. */
function startProxy(gateway: { address: string; interfaceUrl: string; bearer: string }): Promise<() => Promise<void>> {
  const proxyOrigin = `http://localhost:${String(PROXY_PORT)}`;
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      // The kit's JSON-RPC client posts to the interface's URL joined with "/".
      const path = (request.url ?? '/').replace(/\/(?=$|\?)/, '') || '/';
      if (path === '/.well-known/agent-card.json') {
        const card = await (await fetch(`${gateway.interfaceUrl}/.well-known/agent-card.json`)).text();
        response.writeHead(200, { 'content-type': 'application/json' }).end(card.replaceAll(gateway.address, proxyOrigin));
        return;
      }
      const body = bodyPassedOn((await bodyOf(request)).toString('utf8'));
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (typeof value === 'string' && name !== 'host' && name !== 'content-length') {
          headers.set(name, value);
        }
      }
      headers.set('authorization', `Bearer ${gateway.bearer}`);
      const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
      const answered = await fetch(`${gateway.address}${path}`, { method: request.method, headers, ...(hasBody ? { body } : {}) });
      response.writeHead(answered.status, Object.fromEntries([...answered.headers].filter(([name]) => name !== 'content-length' && name !== 'content-encoding' && name !== 'transfer-encoding')));
      response.end(Buffer.from(await answered.arrayBuffer()));
    })().catch((error: unknown) => {
      response.writeHead(500).end(String(error));
    });
  });
  return new Promise((resolve) => {
    server.listen(PROXY_PORT, '127.0.0.1', () => {
      resolve(() => new Promise((closed) => server.close(() => { closed(); })));
    });
  });
}

function runKit(folder: string, kitArguments: string[]): Promise<number> {
  return new Promise((resolve) => {
    const kit = spawn(join(folder, '.venv/bin/python'), ['run_tck.py', '--sut-host', `http://localhost:${String(PROXY_PORT)}`, ...kitArguments], { cwd: folder, stdio: 'inherit' });
    kit.on('exit', (code) => { resolve(code ?? 1); });
  });
}

process.env.RYUK_CONTAINER_IMAGE ??= REAPER_IMAGE;
const postgres = await new TestPostgres(POSTGRES_IMAGE).start();
const fleet = await startFleetServer(postgres.getConnectionUri());
const port = await aFreePort();
const address = `http://127.0.0.1:${String(port)}`;
const databaseUrl = await migratedDatabase(postgres.getConnectionUri());
const app = createGatewayApp({ databaseUrl, fleetUrl: fleet.url, logger: false, publicUrl: address, gatewaySecret: GATEWAY_SECRET, mcpWaitMaxMs: WAIT_MAX_MS });
await app.server.listen({ host: '127.0.0.1', port });

const cookie = await signIn(fleet);
const gatewayShip = await commission(fleet, { cookie, ship: { name: 'gateway', type: 'gateway', kind: 'app', scopes: GATEWAY_SCOPES } });
await connectGateway(address, { cookie, ...gatewayShip });
const session = await fetch(`${fleet.url}/trpc/console.session`, { headers: { cookie } });
const fleetId = z.object({ result: z.object({ data: z.object({ fleetId: idSchema('fleet') }) }) }).parse(await session.json()).result.data.fleetId;
const owner: ShipId = (await commission(fleet, { cookie, ship: { name: 'person-owner', type: 'person', kind: 'person' } })).shipId;
const approver = await register(fleet, await commission(fleet, { cookie, ship: { name: 'approver', type: 'agent', scopes: ['fleet:read', 'gateway:approve'] } }));
await outsidePartiesOn(databaseUrl, fleetId);

const added = await mutate(address, { procedure: 'parties.addA2aClient', crewToken: approver, body: { requestId: crypto.randomUUID(), name: 'supplier', ownerShipId: owner, scopes: ['fleet:read'] } });
const { bearer } = z.object({ result: z.object({ data: z.object({ bearer: z.string() }) }) }).parse(await added.json()).result.data;

const kitShip = await commission(fleet, { cookie, ship: { name: 'kit-agent', type: 'kit-agent', kind: 'app' } });
const crewToken = await register(fleet, kitShip);
await asCrew(fleet, { crewToken, path: '/ship/setStatement', body: { summary: 'The A2A TCK agent: acts out the kit scenarios.', capabilities: [{ name: 'kit', description: 'Acts out a kit scenario.', inputModes: ['text/plain'], waitMs: WAIT_MAX_MS }] } });
const interfaceUrl = `${address}/gw/a2a/${createShipAliases(GATEWAY_SECRET).aliasOf(fleetId, kitShip.shipId)}`;

let isDone = false;
const ship = actOutScenarios({ fleet, crewToken }, () => isDone);
const stopProxy = await startProxy({ address, interfaceUrl, bearer });

const code = await runKit(kitFolder, process.argv.slice(3));

isDone = true;
await stopProxy();
await app.close();
await fleet.stop();
await ship.catch(() => undefined);
await postgres.stop();
process.exit(code);
