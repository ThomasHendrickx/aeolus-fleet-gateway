import { beforeEach, describe, expect, it } from 'vitest';

import { CARD_URL, anAgentParty, answeredCard, fakeAgentCards } from '../../../test/support/a2a-agent-fakes.js';
import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { fakeStatementDoor } from '../../../test/support/mcp-out-fakes.js';
import { OWNER_SHIP_ID, memoryPartyStore } from '../../../test/support/party-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import { err } from '../shared/result.js';
import { createMarkA2aAgent } from './mark-a2a-agent.js';
import { createStateA2aAgent } from './state-a2a-agent.js';

const APPROVER: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc-1', personShipId: OWNER_SHIP_ID, accountToken: 'account-token', scopes: ['gateway:approve', 'fleet:read'] };

let parties: ReturnType<typeof memoryPartyStore>;
let cards: ReturnType<typeof fakeAgentCards>;
let door: ReturnType<typeof fakeStatementDoor>;
let mark: ReturnType<typeof createMarkA2aAgent>;

beforeEach(async () => {
  parties = memoryPartyStore();
  await parties.save(anAgentParty());
  cards = fakeAgentCards({ [CARD_URL]: answeredCard() });
  door = fakeStatementDoor();
  mark = createMarkA2aAgent({ parties, stateA2aAgent: createStateA2aAgent({ parties, cards, door, timing: { waitMs: 10_000, deadlineMs: 300_000 } }) });
});

describe('an approver marks an outside A2A agent not repeatable, or repeatable again (A9)', () => {
  it('keeps the mark, then states every capability without repeatable at once', async () => {
    await expect(mark({ actor: APPROVER, name: 'supplier', isRepeatable: false })).resolves.toEqual({ isOk: true, value: { isRepeatable: false, statementRefusal: null } });
    await expect(parties.find(FLEET_ID, 'supplier')).resolves.toMatchObject({ isRepeatable: false });
    expect(door.stated[0]?.statement.capabilities[0]).not.toHaveProperty('repeatable');
  });

  it('marks it repeatable again', async () => {
    await mark({ actor: APPROVER, name: 'supplier', isRepeatable: false });

    await mark({ actor: APPROVER, name: 'supplier', isRepeatable: true });

    expect(door.stated.at(-1)?.statement.capabilities[0]).toMatchObject({ repeatable: true });
  });

  it('keeps the mark while the card cannot be stated, saying why, for the next statement', async () => {
    cards.cards[CARD_URL] = err({ kind: 'UNREACHABLE', reason: 'connection refused' });

    const marked = await mark({ actor: APPROVER, name: 'supplier', isRepeatable: false });

    expect(marked).toMatchObject({ isOk: true, value: { isRepeatable: false } });
    expect(marked.isOk ? marked.value.statementRefusal : null).toContain('connection refused');
    await expect(parties.find(FLEET_ID, 'supplier')).resolves.toMatchObject({ isRepeatable: false });
  });

  it('refuses an actor not holding gateway:approve, keeping no mark', async () => {
    await expect(mark({ actor: { ...APPROVER, scopes: ['fleet:manage'] }, name: 'supplier', isRepeatable: false })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_AN_APPROVER' } });
    await expect(parties.find(FLEET_ID, 'supplier')).resolves.toMatchObject({ isRepeatable: true });
  });

  it('refuses a party that is no A2A agent', async () => {
    await expect(mark({ actor: APPROVER, name: 'crm', isRepeatable: false })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_PARTY' } });
  });

  it("marks an agent in the actor's own fleet only", async () => {
    const elsewhere: Actor = { ...APPROVER, fleetId: 'flt_01m3tb1zgr5h2ffee12xnch8zz' };

    await expect(mark({ actor: elsewhere, name: 'supplier', isRepeatable: false })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_PARTY' } });
  });
});
