/**
 * The fleet's ship calls over its REST API (`/api/v1`), as any ship that is
 * not TypeScript-bound may make them: the gateway uses the public API like
 * any client. A refusal reads as the fleet's code and message. While the
 * fleet is busy (nothing stored), each call is made again by itself with the
 * same body, after each of the busy waits (each drawn by `busyWaitMs`).
 */
import { setTimeout as wait } from 'node:timers/promises';

import {
  ACCOUNT_TOKEN_HEADER,
  ON_BEHALF_OF_HEADER,
  shipOutputSchema,
  busyWaitMs,
  commissionShipOutputSchema,
  discoverOutputSchema,
  FLEET_BUSY_WAITS_MS,
  handedOutputSchema,
  idSchema,
  inboxOutputSchema,
  pushReceiveOutputSchema,
  QUESTION_CONTENT_TYPE,
  questionSchema,
  sendOutputSchema,
  shipDetailOutputSchema,
  startingPromptOutputSchema,
  type ShipId,
} from '@aeolus-fleet/common';
import { z } from 'zod';

import type { FleetDoor, FleetRefusal } from '../../core/connection/ports.js';
import type { CallSender, Discovery } from '../../core/mcp-in/ports.js';
import type { ProxyShipCrew } from '../../core/mcp-out/hand-call.js';
import type { StatementDoor } from '../../core/mcp-out/state-party.js';
import type { ProxyShipDoor } from '../../core/parties/ports.js';
import type { AccountDoor, PersonShipDoor } from '../../core/people/ports.js';
import type { Owners } from '../../core/requests/ports.js';
import { err, ok, type Result } from '../../core/shared/result.js';

const refusalSchema = z.object({ code: z.string(), message: z.string() });

/** The fleet's code for a call it could not start: nothing was stored, so the same call may be made again. */
const FLEET_BUSY = 'SERVICE_UNAVAILABLE';

/** Where the gateway says its ships run: on a server the operator runs. */
const LOCATION = { kind: 'SERVER' } as const;

/** The harness the gateway states when it registers a ship: it is software, not a model. */
const HARNESS = 'aeolus-gateway';

/** One call to the fleet. */
interface FleetCall<T> {
  path: string;
  method: 'GET' | 'POST';
  crewToken?: string;
  /** The account a call is made for, beside the gateway's crew token (decision 0057). */
  accountToken?: string;
  /** The ship a read is made on behalf of (fleet:on-behalf): it answers within that ship's read reach (decision 0034). */
  onBehalfOf?: ShipId;
  body?: unknown;
  answers: z.ZodType<T>;
  /** Ends a call that waits, such as pushReceive, once it aborts. */
  signal?: AbortSignal;
}

/** Where the fleet answers, how long to wait before each next call while it is busy, the draw for each wait, and how a drawn wait is waited. */
interface Door {
  fleetUrl: string;
  busyWaitsMs: readonly number[];
  random: () => number;
  wait: (waitMs: number) => Promise<void>;
}

async function callFleet<T>({ fleetUrl, busyWaitsMs, random, wait: waitBusy }: Door, request: FleetCall<T>): Promise<Result<T, FleetRefusal>> {
  for (const waitMs of busyWaitsMs) {
    const answered = await callOnce(fleetUrl, request);
    if (answered.isOk || answered.error.code !== FLEET_BUSY) {
      return answered;
    }
    await waitBusy(busyWaitMs(waitMs, random));
  }
  return callOnce(fleetUrl, request);
}

async function callOnce<T>(fleetUrl: string, request: FleetCall<T>): Promise<Result<T, FleetRefusal>> {
  const headers: Record<string, string> = {};
  if (request.crewToken !== undefined) {
    headers.authorization = `Bearer ${request.crewToken}`;
  }
  if (request.accountToken !== undefined) {
    headers[ACCOUNT_TOKEN_HEADER] = request.accountToken;
  }
  if (request.onBehalfOf !== undefined) {
    headers[ON_BEHALF_OF_HEADER] = request.onBehalfOf;
  }
  if (request.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  let response: Response;
  let body: unknown;
  try {
    response = await fetch(`${fleetUrl}/api/v1${request.path}`, {
      method: request.method,
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    body = await response.json();
  } catch (error) {
    return err({ code: 'UNAVAILABLE', message: `The fleet did not answer: ${error instanceof Error ? error.message : String(error)}` });
  }
  return response.ok ? ok(request.answers.parse(body)) : err(refusalSchema.parse(body));
}

/** A question's payload, if it parses as one. */
function questionOf(payload: string) {
  try {
    return questionSchema.safeParse(JSON.parse(payload)).data;
  } catch {
    return undefined;
  }
}

export function createRestFleetDoor(
  fleetUrl: string,
  options: { busyWaitsMs?: readonly number[]; random?: () => number; wait?: (waitMs: number) => Promise<void> } = {},
): FleetDoor & ProxyShipDoor & StatementDoor & ProxyShipCrew & Discovery & CallSender & AccountDoor & Owners & { person: PersonShipDoor } {
  const door = { fleetUrl, busyWaitsMs: options.busyWaitsMs ?? FLEET_BUSY_WAITS_MS, random: options.random ?? Math.random, wait: options.wait ?? ((waitMs: number) => wait(waitMs)) };
  const call = <T>(request: FleetCall<T>) => callFleet(door, request);
  const done = async (crewToken: string, request: { path: string; body: unknown }) => {
    const answered = await call({ ...request, method: 'POST', crewToken, answers: z.unknown() });
    return answered.isOk ? ok(undefined) : answered;
  };
  return {
    startingPrompt: async ({ crewToken, accountToken, shipId }) => {
      const issued = await call({ path: '/fleet/getStartingPrompt', method: 'POST', crewToken, accountToken, body: { shipId }, answers: startingPromptOutputSchema });
      return issued.isOk ? ok({ secret: issued.value.secret }) : issued;
    },
    release: async ({ crewToken, accountToken, shipId }) => {
      const released = await call({ path: '/fleet/release', method: 'POST', crewToken, accountToken, body: { shipId }, answers: z.unknown() });
      return released.isOk ? ok(undefined) : released;
    },
    register: ({ shipId, secret }) =>
      call({ path: '/ship/register', method: 'POST', body: { shipId, secret, location: LOCATION, harness: HARNESS }, answers: z.object({ crewToken: z.string() }) }),
    whoami: (crewToken) =>
      call({
        path: '/ship/whoami',
        method: 'GET',
        crewToken,
        answers: z.object({ shipId: idSchema('ship'), fleetId: idSchema('fleet'), name: z.string(), type: z.string() }),
      }),
    ownerOf: async (crewToken, shipId) => {
      const read = await call({ path: '/fleet/ship', method: 'POST', crewToken, body: { shipId }, answers: shipDetailOutputSchema });
      return read.isOk ? ok(read.value.owner?.id ?? null) : read;
    },
    getShip: async (crewToken, { shipId, onBehalfOf }) => {
      const read = await call({ path: '/fleet/ship', method: 'POST', crewToken, onBehalfOf, body: { shipId }, answers: shipOutputSchema });
      if (!read.isOk) {
        return read;
      }
      if ('isInReadReach' in read.value) {
        return err({ code: 'FORBIDDEN', message: `${read.value.name} is outside the read reach` });
      }
      const { status, scopes } = read.value;
      return ok({ status, scopes });
    },
    // An app ship owned by the owner argo picked: core 0.28's commission (aeolus-fleet#959).
    commissionAppShip: async (crewToken, { name, type, owner, idempotencyKey, scopes }) => {
      const commissioned = await call({
        path: '/fleet/commission',
        method: 'POST',
        crewToken,
        body: { name, type, kind: 'app', owner, idempotencyKey, scopes },
        answers: commissionShipOutputSchema,
      });
      return commissioned.isOk ? ok({ shipId: commissioned.value.shipId, secret: commissioned.value.secret }) : commissioned;
    },
    deregister: async (crewToken) => {
      const ended = await call({ path: '/ship/deregister', method: 'POST', crewToken, body: {}, answers: z.unknown() });
      return ended.isOk ? ok(undefined) : ended;
    },
    // The whole statement, as the proxy ship's crew; core 0.27 refuses the fields it does not know yet (aeolus-fleet#956).
    setStatement: async (crewToken, statement) => {
      const stated = await call({ path: '/ship/setStatement', method: 'POST', crewToken, body: statement, answers: z.object({ version: z.int() }) });
      return stated.isOk ? ok(undefined) : stated;
    },
    // A proxy ship's crew calls (decision 0040), as the gateway's computer side makes them.
    pushReceive: async (crewToken, { max, signal }) => {
      const taken = await call({ path: '/ship/pushReceive', method: 'POST', crewToken, body: { max }, answers: pushReceiveOutputSchema, signal });
      return taken.isOk
        ? ok(
            taken.value.deliveries.map(({ deliveryId, messageId, senderShipId, contentType, payload, state, handOverNumber, inReplyTo }) => ({
              deliveryId,
              messageId,
              senderShipId,
              contentType,
              payload,
              state,
              handOverNumber,
              inReplyTo,
            })),
          )
        : taken;
    },
    // A person ship's crew calls, as the gateway makes them for the person (decision 0057).
    person: {
      inbox: (crewToken) => call({ path: '/ship/inbox', method: 'POST', crewToken, body: { waitSeconds: 0 }, answers: inboxOutputSchema }),
      pushReceive: async (crewToken, { max }) => {
        const taken = await call({ path: '/ship/pushReceive', method: 'POST', crewToken, body: { max }, answers: pushReceiveOutputSchema });
        return taken.isOk
          ? ok(
              taken.value.deliveries.map(({ deliveryId, messageId, senderShipId, senderName, contentType, payload, sentAt, inReplyTo }) => ({
                deliveryId,
                messageId,
                senderShipId,
                senderName,
                contentType,
                payload,
                questionTitle: contentType === QUESTION_CONTENT_TYPE ? (questionOf(payload)?.title ?? null) : null,
                sentAt: new Date(sentAt),
                inReplyTo,
              })),
            )
          : taken;
      },
      ack: (crewToken, deliveryId) => done(crewToken, { path: '/ship/ack', body: { deliveryId } }),
      reply: (crewToken, { to, inReplyTo, contentType, payload, idempotencyKey }) =>
        done(crewToken, { path: '/ship/send', body: { selector: { kind: 'ship', shipId: to }, inReplyTo, contentType, payload, idempotencyKey } }),
      handled: (crewToken, deliveryId) => done(crewToken, { path: '/ship/handled', body: { deliveryId } }),
    },
    handed: async (crewToken, handOver) => {
      const answered = await call({ path: '/ship/handed', method: 'POST', crewToken, body: handOver, answers: handedOutputSchema });
      return answered.isOk ? ok(answered.value.state) : answered;
    },
    reply: async (crewToken, { to, inReplyTo, contentType, payload, idempotencyKey }) => {
      const sent = await call({
        path: '/ship/send',
        method: 'POST',
        crewToken,
        body: { selector: { kind: 'ship', shipId: to }, inReplyTo, contentType, payload, idempotencyKey },
        answers: sendOutputSchema,
      });
      return sent.isOk ? ok(undefined) : sent;
    },
    ack: (crewToken, deliveryId) => done(crewToken, { path: '/ship/ack', body: { deliveryId } }),
    handled: (crewToken, deliveryId) => done(crewToken, { path: '/ship/handled', body: { deliveryId } }),
    notHandled: (crewToken, report) => done(crewToken, { path: '/ship/notHandled', body: report }),
    send: async (crewToken, { to, contentType, payload, idempotencyKey }) =>
      call({ path: '/ship/send', method: 'POST', crewToken, body: { selector: { kind: 'ship', shipId: to }, contentType, payload, idempotencyKey }, answers: sendOutputSchema }),
    discover: async (crewToken) => {
      const found = await call({ path: '/ship/discover', method: 'GET', crewToken, answers: discoverOutputSchema });
      return found.isOk ? ok(found.value.ships.map(({ id, kind, statement }) => ({ shipId: id, kind, statement }))) : found;
    },
    declareScopes: async (crewToken, declaration) => {
      const declared = await call({ path: '/fleet/declareScopes', method: 'POST', crewToken, body: declaration, answers: z.unknown() });
      return declared.isOk ? ok(undefined) : declared;
    },
  };
}
