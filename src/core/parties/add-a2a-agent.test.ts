import { beforeEach, describe, expect, it } from 'vitest';

import { CARD_URL, anAgentCard, answeredCard, fakeAgentCards } from '../../../test/support/a2a-agent-fakes.js';
import { FLEET_ID, SHIP_ID, memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { plainHasher } from '../../../test/support/memory-installation.js';
import { OWNER_SHIP_ID, PROXY_SHIP_ID, fakeProxyShipFleet, memoryPartyStore } from '../../../test/support/party-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import { err } from '../shared/result.js';
import { createAddA2aAgent } from './add-a2a-agent.js';

const AT = new Date('2026-10-23T10:00:00.000Z');
const TIMING = { waitMs: 10_000, deadlineMs: 300_000 };

/** An account holding the approving scope and fleet:read. */
const APPROVER: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc-1', personShipId: OWNER_SHIP_ID, accountToken: 'account-token', scopes: ['gateway:approve', 'fleet:read'] };

let isOn: boolean;
let fleet: ReturnType<typeof fakeProxyShipFleet>;
let parties: ReturnType<typeof memoryPartyStore>;
let cards: ReturnType<typeof fakeAgentCards>;
let add: ReturnType<typeof createAddA2aAgent>;

beforeEach(async () => {
  isOn = true;
  fleet = fakeProxyShipFleet();
  parties = memoryPartyStore();
  cards = fakeAgentCards({ [CARD_URL]: answeredCard() });
  const connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: AT });
  add = createAddA2aAgent({ connections, parties, door: fleet.door, hasher: plainHasher, servesOutsideParties: () => Promise.resolve(isOn), clock: { now: () => AT }, cards, timing: TIMING });
});

function anAddition(overrides: Partial<Parameters<typeof add>[0]> = {}): Parameters<typeof add>[0] {
  return { actor: APPROVER, requestId: 'r-1', name: 'supplier', cardUrl: CARD_URL, credential: { kind: 'bearer', token: 'tok-1' }, concurrencyLimit: 4, ownerShipId: OWNER_SHIP_ID, scopes: ['fleet:read'], ...overrides };
}

describe('an approver adds an outside A2A agent by its card address (slice 5)', () => {
  it('reads the card, then commissions an a2a-agent proxy ship with the owner and scopes chosen, under the request as its key', async () => {
    await add(anAddition());

    expect(cards.reads).toEqual([CARD_URL]);
    expect(fleet.state.commissioned).toEqual([{ name: 'supplier', type: 'a2a-agent', owner: OWNER_SHIP_ID, idempotencyKey: 'r-1', scopes: ['fleet:read'] }]);
  });

  it('answers the crewed party, never its credential', async () => {
    await expect(add(anAddition())).resolves.toEqual({
      isOk: true,
      value: { name: 'supplier', kind: 'a2aAgent', cardUrl: CARD_URL, credentialKind: 'bearer', concurrencyLimit: 4, isRepeatable: true, state: 'crewed', proxyShipId: PROXY_SHIP_ID },
    });
  });

  it('keeps the credential in the vault beside the crew token, the agent repeatable', async () => {
    await add(anAddition({ credential: { kind: 'clientCredentials', clientId: 'gw', clientSecret: 's-1', issuer: 'https://auth.supplier.example' } }));

    await expect(parties.find(FLEET_ID, 'supplier')).resolves.toMatchObject({
      kind: 'a2aAgent',
      cardUrl: CARD_URL,
      credential: { kind: 'clientCredentials', clientId: 'gw', clientSecret: 's-1', issuer: 'https://auth.supplier.example' },
      isRepeatable: true,
      crewToken: 'aeolus_ct_v1_proxy',
    });
  });

  it('takes an agent that asks for no credential', async () => {
    await expect(add(anAddition({ credential: { kind: 'none' } }))).resolves.toMatchObject({ isOk: true, value: { credentialKind: 'none' } });
  });

  it('writes the domain it read the card from over TLS as the a2aCardDomain fact', async () => {
    await add(anAddition());

    expect(fleet.state.verified.get(PROXY_SHIP_ID)?.facts).toEqual([{ checked: 'a2aCardDomain', value: 'agent.supplier.example' }]);
  });

  it('writes no fact for a card read without TLS', async () => {
    const plain = 'http://agent.internal:8080/.well-known/agent-card.json';
    cards.cards[plain] = answeredCard();

    await add(anAddition({ cardUrl: plain }));

    expect(fleet.state.verified.size).toBe(0);
  });

  it('adds nothing for a card that does not answer, saying why', async () => {
    cards.cards[CARD_URL] = err({ kind: 'UNREACHABLE', reason: 'connection refused' });

    const added = await add(anAddition());

    expect(added).toMatchObject({ isOk: false, error: { kind: 'CARD_UNREACHABLE' } });
    expect(added.isOk ? '' : added.error.message).toContain('connection refused');
    expect({ commissioned: fleet.state.commissioned, held: parties.held.size }).toEqual({ commissioned: [], held: 0 });
  });

  it('adds nothing for an answer that is no agent card, saying why', async () => {
    cards.cards[CARD_URL] = err({ kind: 'NOT_A_CARD', reason: 'name: required' });

    const added = await add(anAddition());

    expect(added).toMatchObject({ isOk: false, error: { kind: 'CARD_INVALID' } });
    expect(added.isOk ? '' : added.error.message).toContain('name: required');
    expect(fleet.state.commissioned).toEqual([]);
  });

  it('adds nothing for a card that makes no valid statement', async () => {
    cards.cards[CARD_URL] = answeredCard(anAgentCard({ skills: [] }));

    await expect(add(anAddition())).resolves.toMatchObject({ isOk: false, error: { kind: 'CARD_INVALID' } });
    expect(fleet.state.commissioned).toEqual([]);
  });

  it('refuses an actor not holding gateway:approve, reading no card', async () => {
    await expect(add(anAddition({ actor: { ...APPROVER, scopes: ['fleet:read'] } }))).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_AN_APPROVER' } });
    expect({ reads: cards.reads, commissioned: fleet.state.commissioned }).toEqual({ reads: [], commissioned: [] });
  });

  it('refuses a scope the approver does not hold', async () => {
    await expect(add(anAddition({ scopes: ['fleet:manage'] }))).resolves.toMatchObject({ isOk: false, error: { kind: 'SCOPE_NOT_HELD' } });
    expect(fleet.state.commissioned).toEqual([]);
  });

  it("adds nothing while the fleet's outside parties are off, reading no card", async () => {
    isOn = false;

    await expect(add(anAddition())).resolves.toMatchObject({ isOk: false, error: { kind: 'OUTSIDE_PARTIES_OFF' } });
    expect({ reads: cards.reads, held: parties.held.size }).toEqual({ reads: [], held: 0 });
  });

  it('answers the same request again with the same party, commissioning nothing again', async () => {
    await add(anAddition());

    await expect(add(anAddition())).resolves.toMatchObject({ isOk: true, value: { state: 'crewed' } });
    expect(fleet.state.commissioned).toHaveLength(1);
  });

  it('refuses a name another party holds', async () => {
    await add(anAddition());

    await expect(add(anAddition({ requestId: 'r-2' }))).resolves.toMatchObject({ isOk: false, error: { kind: 'PARTY_EXISTS' } });
  });
});
