/**
 * What a ship of the fleet does in a test, through core's REST API with its
 * crew token: it sends, and it receives and acknowledges its replies.
 */
import { lookupInputSchema, lookupOutputSchema, receiveOutputSchema, sendOutputSchema, type MessageId, type ShipId } from '@aeolus-fleet/common';

import type { FleetServer } from './fleet-server.js';

async function call(fleet: FleetServer, request: { crewToken: string; path: string; body: unknown }): Promise<unknown> {
  const response = await fetch(`${fleet.url}/api/v1${request.path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${request.crewToken}` },
    body: JSON.stringify(request.body),
  });
  if (!response.ok) {
    throw new Error(`${request.path} failed: ${await response.text()}`);
  }
  return response.json();
}

/** Sends one message to a ship: its id. */
export async function send(fleet: FleetServer, request: { crewToken: string; to: ShipId; contentType: string; payload: string }): Promise<MessageId> {
  const body = { selector: { kind: 'ship', shipId: request.to }, contentType: request.contentType, payload: request.payload, idempotencyKey: crypto.randomUUID(), model: 'claude-opus-5-5' };
  return sendOutputSchema.parse(await call(fleet, { crewToken: request.crewToken, path: '/ship/send', body })).messageId;
}

/** How long a test ship waits for its next delivery, and how often it looks meanwhile. */
const RECEIVE_WAIT_MS = 10_000;
const RECEIVE_POLL_MS = 100;
/** How long a test ship waits to see that nothing more comes. */
const NOTHING_MORE_MS = 2_000;

/**
 * Receives the ship's next delivery and acknowledges it. Core's receive answers
 * at once (long-poll W8), so the ship looks again every RECEIVE_POLL_MS until a
 * delivery comes or `waitMs` passes: none when none came.
 */
async function receiveWithin(fleet: FleetServer, { crewToken, waitMs }: { crewToken: string; waitMs: number }) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const [delivery] = receiveOutputSchema.parse(await call(fleet, { crewToken, path: '/ship/receive', body: {} })).deliveries;
    if (delivery) {
      await call(fleet, { crewToken, path: '/ship/ack', body: { deliveryId: delivery.deliveryId } });
      return delivery;
    }
    if (Date.now() >= deadline) {
      return undefined;
    }
    await new Promise((resolve) => setTimeout(resolve, RECEIVE_POLL_MS));
  }
}

/** Receives the ship's next delivery and acknowledges it, waiting up to RECEIVE_WAIT_MS: none when none came. */
export function receiveOne(fleet: FleetServer, crewToken: string) {
  return receiveWithin(fleet, { crewToken, waitMs: RECEIVE_WAIT_MS });
}

/** What else comes for the ship within NOTHING_MORE_MS, received and acknowledged: none when nothing more came. */
export function receiveAnyMore(fleet: FleetServer, crewToken: string) {
  return receiveWithin(fleet, { crewToken, waitMs: NOTHING_MORE_MS });
}


/** Reads one reachable ship's full statement as the caller, never from discovery. */
export async function lookupShip(fleet: FleetServer, { crewToken, target }: { crewToken: string; target: { id: string } | { name: string } }) {
  return lookupOutputSchema.parse(await call(fleet, { crewToken, path: '/ship/lookup', body: lookupInputSchema.parse({ ...target, includeStatement: true }) }));
}
