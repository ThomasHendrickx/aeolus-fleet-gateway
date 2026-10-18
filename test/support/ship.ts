/**
 * What a ship of the fleet does in a test, through core's REST API with its
 * crew token: it sends, and it receives and acknowledges its replies.
 */
import { receiveOutputSchema, sendOutputSchema, type MessageId, type ShipId } from '@aeolus-fleet/common';

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
  const body = { selector: { kind: 'ship', shipId: request.to }, contentType: request.contentType, payload: request.payload, idempotencyKey: crypto.randomUUID() };
  return sendOutputSchema.parse(await call(fleet, { crewToken: request.crewToken, path: '/ship/send', body })).messageId;
}

/** Receives the ship's next delivery and acknowledges it, waiting as a receive does: none when none came. */
export async function receiveOne(fleet: FleetServer, crewToken: string) {
  const [delivery] = receiveOutputSchema.parse(await call(fleet, { crewToken, path: '/ship/receive', body: {} })).deliveries;
  if (delivery) {
    await call(fleet, { crewToken, path: '/ship/ack', body: { deliveryId: delivery.deliveryId } });
  }
  return delivery;
}
