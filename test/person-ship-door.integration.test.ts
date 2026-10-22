import { receiveOutputSchema } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';

import { createRestFleetDoor } from '../src/adapters/fleet/rest-fleet-door.js';
import type { PersonShipDoor } from '../src/core/people/ports.js';
import { applyEmptyOwnRules, commission, register, signIn } from './support/argo.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';

// The fleet's calls the gateway makes as the crew of a person ship, against a
// real core: what the ship may send to, and the person's own message
// (aeolus-fleet #1046). The fleet decides both; its refusals say why.

const QUESTION = 'application/vnd.aeolus.question+json';

let fleet: FleetServer;
let cookie: string;
let door: PersonShipDoor;
/** Charlotte's person ship's crew token. */
let charlotte: string;
/** The issue tracker's crew token. */
let tracker: string;

beforeEach(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  cookie = await signIn(fleet);
  door = createRestFleetDoor(fleet.url).person;
  charlotte = await register(fleet, await commission(fleet, { cookie, ship: { name: 'charlotte', type: 'person', kind: 'person' } }));
  tracker = await register(fleet, await commission(fleet, { cookie, ship: { name: 'tracker', type: 'issue-tracker', kind: 'app' } }));
  const stated = await fetch(`${fleet.url}/api/v1/ship/setStatement`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tracker}` },
    body: JSON.stringify({ summary: 'The issue tracker', capabilities: [{ name: 'open-issue', description: 'Opens an issue' }] }),
  });
  expect(stated.status).toBe(200);
});

afterEach(async () => {
  await fleet.stop();
});

/** What waits for the tracker, as its crew receives it. */
async function trackerReceives() {
  const response = await fetch(`${fleet.url}/api/v1/ship/receive`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tracker}` },
    body: JSON.stringify({ max: 10 }),
  });
  return receiveOutputSchema.parse(await response.json()).deliveries.map(({ senderName, contentType, payload }) => ({ senderName, contentType, payload }));
}

describe('a person ship discovers what it may send to', () => {
  it('finds each ship by name, with its type, kind and statement, and each type', async () => {
    const found = await door.discover(charlotte);

    expect(found.isOk && { tracker: found.value.ships.find(({ name }) => name === 'tracker'), type: found.value.types.find(({ type }) => type === 'issue-tracker') }).toEqual({
      tracker: { name: 'tracker', type: 'issue-tracker', kind: 'app', statement: { by: 'crew', version: 1, summary: 'The issue tracker', capabilities: [{ name: 'open-issue', description: 'Opens an issue' }] } },
      type: { type: 'issue-tracker', reachable: 1 },
    });
  });

  it('finds no ship the network rules do not let it send to', async () => {
    await applyEmptyOwnRules(fleet, cookie);

    const found = await door.discover(charlotte);

    expect(found.isOk && found.value.ships.map(({ name }) => name)).not.toContain('tracker');
  });
});

describe("a person ship sends the person's own message", () => {
  it('reaches a ship by its name, a question with numbered options as its content type says', async () => {
    const question = JSON.stringify({ id: '0b6f2a52-6a43-4a43-9a43-3f3c3b9b1a10', title: 'Which release?', context: '', options: [{ key: 1, label: '1.4' }, { key: 2, label: '1.5' }] });

    const sent = await door.send(charlotte, { to: { kind: 'ship', name: 'tracker' }, contentType: QUESTION, payload: question, idempotencyKey: 'charlotte-1' });

    expect(sent.isOk && sent.value.messageId.startsWith('msg_')).toBe(true);
    await expect(trackerReceives()).resolves.toEqual([{ senderName: 'charlotte', contentType: QUESTION, payload: question }]);
  });

  it('reaches any ship of a type', async () => {
    await door.send(charlotte, { to: { kind: 'type', type: 'issue-tracker' }, contentType: 'text/plain', payload: 'The build is red', idempotencyKey: 'charlotte-2' });

    await expect(trackerReceives()).resolves.toEqual([{ senderName: 'charlotte', contentType: 'text/plain', payload: 'The build is red' }]);
  });

  it('is refused for a name no active ship has, saying so', async () => {
    const sent = await door.send(charlotte, { to: { kind: 'ship', name: 'nobody' }, contentType: 'text/plain', payload: 'Hello', idempotencyKey: 'charlotte-3' });

    expect(!sent.isOk && sent.error.message).toContain('No active ship is named nobody');
  });

  it('is refused when no network rule lets it send there, saying so', async () => {
    await applyEmptyOwnRules(fleet, cookie);

    const sent = await door.send(charlotte, { to: { kind: 'ship', name: 'tracker' }, contentType: 'text/plain', payload: 'Hello', idempotencyKey: 'charlotte-4' });

    expect(sent).toMatchObject({ isOk: false, error: { message: 'The network rules do not allow this send' } });
  });

  it('is refused a payload over 64 KB, saying so', async () => {
    const sent = await door.send(charlotte, { to: { kind: 'ship', name: 'tracker' }, contentType: 'text/plain', payload: 'x'.repeat(65_537), idempotencyKey: 'charlotte-5' });

    expect(!sent.isOk && sent.error.message).toContain('64 KB');
  });
});

describe('a person ship reads again a delivery the person opened (aeolus-fleet #1046)', () => {
  /** The tracker sends charlotte a message; charlotte's crew takes it and acknowledges it, as the person opening it does. */
  async function charlotteOpensTheTrackersMessage() {
    const sent = await fetch(`${fleet.url}/api/v1/ship/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tracker}` },
      body: JSON.stringify({ selector: { kind: 'ship', name: 'charlotte' }, contentType: 'text/plain', payload: 'Issue 7 is closed', idempotencyKey: 'tracker-1' }),
    });
    expect(sent.status).toBe(200);
    const taken = await door.pushReceive(charlotte, { max: 1 });
    const [opened] = taken.isOk ? taken.value : [];
    if (opened === undefined) {
      throw new Error('charlotte received no delivery');
    }
    expect((await door.ack(charlotte, opened.deliveryId)).isOk).toBe(true);
    return opened;
  }

  it('reads it again whole by its id while it is not handled', async () => {
    const opened = await charlotteOpensTheTrackersMessage();

    const again = await door.delivery(charlotte, opened.deliveryId);

    expect(again).toMatchObject({ isOk: true, value: { deliveryId: opened.deliveryId, messageId: opened.messageId, senderName: 'tracker', contentType: 'text/plain', payload: 'Issue 7 is closed' } });
  });

  it('is refused once the person dealt with it, saying why', async () => {
    const opened = await charlotteOpensTheTrackersMessage();
    expect((await door.handled(charlotte, opened.deliveryId)).isOk).toBe(true);

    const again = await door.delivery(charlotte, opened.deliveryId);

    expect(again.isOk).toBe(false);
    expect(!again.isOk && again.error.message).not.toBe('');
  });
});
