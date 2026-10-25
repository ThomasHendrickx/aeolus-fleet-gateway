import { beforeEach, describe, expect, it } from 'vitest';

import { CARD_URL, anAgentCard, anAgentParty, answeredCard, fakeAgentCards } from '../../../test/support/a2a-agent-fakes.js';
import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { fakeStatementDoor } from '../../../test/support/mcp-out-fakes.js';
import { memoryPartyStore, memoryScopeRequirements } from '../../../test/support/party-fakes.js';
import { err } from '../shared/result.js';
import { createStateA2aAgent } from './state-a2a-agent.js';

let parties: ReturnType<typeof memoryPartyStore>;
let cards: ReturnType<typeof fakeAgentCards>;
let door: ReturnType<typeof fakeStatementDoor>;
let requirements: ReturnType<typeof memoryScopeRequirements>;
let state: ReturnType<typeof createStateA2aAgent>;

beforeEach(async () => {
  parties = memoryPartyStore();
  await parties.save(anAgentParty());
  cards = fakeAgentCards({ [CARD_URL]: answeredCard() });
  door = fakeStatementDoor();
  requirements = memoryScopeRequirements();
  state = createStateA2aAgent({ parties, cards, door, requirements, timing: { waitMs: 10_000, deadlineMs: 300_000 } });
});

describe("the gateway states an outside A2A agent's proxy ship from its card, as its crew (slice 5)", () => {
  it('reads the card now and states its skills as the proxy ship, with its crew token', async () => {
    await expect(state({ fleetId: FLEET_ID, name: 'supplier' })).resolves.toEqual({ isOk: true, value: { capabilities: ['quote'] } });
    expect(cards.reads).toEqual([CARD_URL]);
    expect(door.stated).toMatchObject([{ crewToken: 'aeolus_ct_v1_proxy', statement: { capabilities: [{ name: 'quote', repeatable: true }] } }]);
  });

  it('states on each skill the scopes the agent needs as they are now (P1)', async () => {
    await requirements.change({ fleetId: FLEET_ID, name: 'supplier' }, { version: 0, party: ['supplier:quote'], tools: new Map() });

    await state({ fleetId: FLEET_ID, name: 'supplier' });

    expect(door.stated).toMatchObject([{ statement: { capabilities: [{ name: 'quote', scopes: ['supplier:quote'] }] } }]);
  });

  it('states no capability repeatable for an agent marked not repeatable (A9)', async () => {
    await parties.save(anAgentParty({ isRepeatable: false }));

    await state({ fleetId: FLEET_ID, name: 'supplier' });

    expect(door.stated[0]?.statement.capabilities[0]).not.toHaveProperty('repeatable');
  });

  it('states nothing while the card does not answer, so the last statement stays', async () => {
    cards.cards[CARD_URL] = err({ kind: 'UNREACHABLE', reason: 'connection refused' });

    await expect(state({ fleetId: FLEET_ID, name: 'supplier' })).resolves.toMatchObject({ isOk: false, error: { kind: 'CARD_UNREACHABLE' } });
    expect(door.stated).toEqual([]);
  });

  it('states nothing for a card gone invalid, saying why', async () => {
    cards.cards[CARD_URL] = answeredCard(anAgentCard({ skills: [] }));

    await expect(state({ fleetId: FLEET_ID, name: 'supplier' })).resolves.toMatchObject({ isOk: false, error: { kind: 'CARD_INVALID' } });
    expect(door.stated).toEqual([]);
  });

  it('states nothing for an answer that is no agent card', async () => {
    cards.cards[CARD_URL] = err({ kind: 'NOT_A_CARD', reason: 'name: required' });

    await expect(state({ fleetId: FLEET_ID, name: 'supplier' })).resolves.toMatchObject({ isOk: false, error: { kind: 'CARD_INVALID' } });
  });

  it('refuses a party that is no A2A agent', async () => {
    await expect(state({ fleetId: FLEET_ID, name: 'crm' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_PARTY' } });
  });

  it('refuses an agent whose proxy ship the gateway does not crew yet', async () => {
    await parties.save(anAgentParty({ state: 'awaitingCrew', crewToken: null }));

    await expect(state({ fleetId: FLEET_ID, name: 'supplier' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_CREWED' } });
    expect(cards.reads).toEqual([]);
  });

  it('answers the fleet refusing the statement', async () => {
    door.state.refusal = { code: 'BAD_REQUEST', message: 'too large' };

    await expect(state({ fleetId: FLEET_ID, name: 'supplier' })).resolves.toMatchObject({ isOk: false, error: { kind: 'STATEMENT_REFUSED' } });
  });
});
