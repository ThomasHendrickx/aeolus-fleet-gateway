import type { ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createArgoInboxDoor } from '../src/adapters/fleet/argo-inbox-door.js';
import { applyEmptyOwnRules, argoShipId, commission, letReadArgo, markDoneAsArgo, register, replyAsArgo, signIn } from './support/argo.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';
import { send } from './support/ship.js';

// The gateway's own ship reads argo's inbox through core's public ship
// contract, by its crew token and within its read reach (argo's inbox,
// AI9; decision 0034): argo's ship, every message to argo with its
// delivery's state, one such message, and the fleet's events about argo
// after a position. Against a real core.

const GATEWAY_SCOPES = ['fleet:read', 'fleet:commission', 'fleet:on-behalf', 'scopes:declare', 'fleet:verify'];

let fleet: FleetServer;
let cookie: string;
let argo: ShipId;
let gateway: { shipId: ShipId; crewToken: string };
let trierarch: string;
const door = () => createArgoInboxDoor({ fleetUrl: fleet.url });

beforeAll(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  cookie = await signIn(fleet);
  argo = await argoShipId(fleet, cookie);
  const gatewayShip = await commission(fleet, { cookie, ship: { name: 'gateway', type: 'gateway', kind: 'app', scopes: GATEWAY_SCOPES } });
  gateway = { shipId: gatewayShip.shipId, crewToken: await register(fleet, gatewayShip) };
  trierarch = await register(fleet, await commission(fleet, { cookie, ship: { name: 'trierarch', type: 'trierarch', scopes: ['messages:send'] } }));
  await applyEmptyOwnRules(fleet, cookie);
});

afterAll(async () => {
  await fleet.stop();
});

describe("argo's inbox as the gateway's ship reads it from core", () => {
  it('finds argo outside its read reach while argo has not added the read rule', async () => {
    await expect(door().argoInReach(gateway.crewToken)).resolves.toEqual({ isOk: true, value: null });
  });

  it('reads nothing of argo without the read rule, not even a message to argo by its id', async () => {
    const messageId = await send(fleet, { crewToken: trierarch, to: argo, contentType: 'text/plain', payload: 'thomas-mac is low on disk: 4% free' });

    await expect(Promise.all([door().entries(gateway.crewToken, argo), door().entry(gateway.crewToken, { argo, messageId })])).resolves.toEqual([
      { isOk: true, value: [] },
      { isOk: true, value: null },
    ]);
  });

  it('finds argo in its read reach once argo adds the read rule', async () => {
    await letReadArgo(fleet, { cookie, readerShipId: gateway.shipId });

    await expect(door().argoInReach(gateway.crewToken)).resolves.toEqual({ isOk: true, value: argo });
  });

  it("reads every message to argo with its delivery's state, and its sender", async () => {
    const entries = await door().entries(gateway.crewToken, argo);

    expect(entries).toMatchObject({ isOk: true, value: [{ sender: { name: 'trierarch' }, contentType: 'text/plain', deliveryState: 'pending' }] });
  });

  it('answers the message a new send to argo concerns, after the position before it', async () => {
    const position = await door().position(gateway.crewToken);
    const afterSeq = position.isOk ? position.value : -1;
    const messageId = await send(fleet, { crewToken: trierarch, to: argo, contentType: 'text/markdown', payload: 'formation recovery given up' });

    const changes = await door().changes(gateway.crewToken, { argo, afterSeq, signal: AbortSignal.timeout(30_000) });

    expect(changes).toMatchObject({ isOk: true, value: { changes: [{ messageId }] } });
  });

  it('answers a message argo marked done in the console as done, and the change it made', async () => {
    const messageId = await send(fleet, { crewToken: trierarch, to: argo, contentType: 'text/plain', payload: 'an API key out of credit' });
    const sent = await door().entry(gateway.crewToken, { argo, messageId });
    const position = await door().position(gateway.crewToken);

    await markDoneAsArgo(fleet, { cookie, deliveryId: sent.isOk ? (sent.value?.deliveryId ?? '') : '' });

    const changes = await door().changes(gateway.crewToken, { argo, afterSeq: position.isOk ? position.value : -1, signal: AbortSignal.timeout(30_000) });
    const done = await door().entry(gateway.crewToken, { argo, messageId });
    const change = changes.isOk ? changes.value.changes.find((each) => each.messageId === messageId) : undefined;
    expect({ by: change?.actorShipId, state: done.isOk ? done.value?.deliveryState : done.error }).toEqual({ by: argo, state: 'acknowledged' });
  });

  it('reads a message to argo whole: its payload, and the title of the question it asks', async () => {
    const question = { id: 'b3f1c6a2-0d7e-4c55-9a51-6f0e4e2d9a11', title: 'Which repository holds the memory plugin?', context: 'builder-memory', options: [{ key: 1, label: 'aeolus-fleet' }], pick: { option: 1, why: 'one place' } };
    const messageId = await send(fleet, { crewToken: trierarch, to: argo, contentType: 'application/vnd.aeolus.question+json', payload: JSON.stringify(question) });

    const read = await door().entry(gateway.crewToken, { argo, messageId });

    expect(read).toMatchObject({ isOk: true, value: { payload: JSON.stringify(question), headline: question.title, askedQuestionId: question.id, withdrawnQuestionId: null } });
  });

  it('reads no message argo sent as one to argo', async () => {
    const messageId = await send(fleet, { crewToken: trierarch, to: argo, contentType: 'text/plain', payload: 'which repository?' });
    const asked = await door().entry(gateway.crewToken, { argo, messageId });
    const replyId = await replyAsArgo(fleet, { cookie, deliveryId: asked.isOk ? (asked.value?.deliveryId ?? '') : '', payload: 'aeolus-fleet' });

    const [reply, entries] = await Promise.all([door().entry(gateway.crewToken, { argo, messageId: replyId }), door().entries(gateway.crewToken, argo)]);

    expect({ reply, isListed: entries.isOk && entries.value.some((entry) => entry.messageId === replyId) }).toEqual({ reply: { isOk: true, value: null }, isListed: false });
  });
});
