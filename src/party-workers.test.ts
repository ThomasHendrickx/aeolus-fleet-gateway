import type { FleetId } from '@aeolus-fleet/common';
import Fastify from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { anAgentParty } from '../test/support/a2a-agent-fakes.js';
import { FLEET_ID, OTHER_FLEET_ID } from '../test/support/fleet-fakes.js';
import { PROXY_SHIP_ID, memoryPartyStore } from '../test/support/party-fakes.js';
import type { McpClientParty, McpServerParty } from './core/parties/party.js';
import { ok } from './core/shared/result.js';
import { createPartyWorkers } from './party-workers.js';

// A crewed party's worker takes its calls only while its fleet's outside
// parties are on (interop I-3): off stops that fleet's workers, and none starts.

function aCrewedServer(fleetId: FleetId, name: string): McpServerParty {
  return {
    fleetId,
    name,
    kind: 'mcpServer',
    url: `https://${name}.example.com/mcp`,
    credential: { kind: 'bearer', token: 't' },
    concurrencyLimit: 4,
  toolSwitches: null,
    state: 'crewed',
    proxyShipId: PROXY_SHIP_ID,
    secret: null,
    crewToken: `aeolus_ct_v1_${name}`,
    requestId: `r-${name}`,
    requestHash: 'h',
    approvedAt: new Date('2026-10-20T09:00:00.000Z'),
  };
}

let parties: ReturnType<typeof memoryPartyStore>;
/** The parties whose worker takes calls now. */
let running: Set<string>;
let servedFleets: Set<FleetId>;
/** The A2A agents whose proxy ship was stated. */
let statedAgents: string[];

beforeEach(async () => {
  parties = memoryPartyStore();
  running = new Set();
  statedAgents = [];
  servedFleets = new Set([FLEET_ID, OTHER_FLEET_ID]);
  await parties.save(aCrewedServer(FLEET_ID, 'crm'));
  await parties.save(aCrewedServer(OTHER_FLEET_ID, 'erp'));
});

/** Takes the party's calls until stopped. */
const runUntilStopped = ({ party, signal }: { party: { name: string }; signal: AbortSignal }) => {
  running.add(party.name);
  return new Promise<{ ended: 'stopped' }>((resolve) => {
    signal.addEventListener('abort', () => {
      running.delete(party.name);
      resolve({ ended: 'stopped' });
    });
  });
};

function workers() {
  return createPartyWorkers({
    parties,
    stateParty: () => Promise.resolve(ok({ capabilities: [] })),
    stateA2aAgent: (agent) => {
      statedAgents.push(agent.name);
      return Promise.resolve(ok({ capabilities: [] }));
    },
    runParty: runUntilStopped,
    runA2aAgent: runUntilStopped,
    collectReplies: () => Promise.resolve({ ended: 'stopped' }),
    pushToWebhooks: () => Promise.resolve(),
    servesOutsideParties: (fleetId) => Promise.resolve(servedFleets.has(fleetId)),
    log: Fastify({ logger: false }).log,
  });
}

/** Lets started workers reach their first step. */
const settled = () => new Promise((resolve) => setImmediate(resolve));

describe("the parties' workers", () => {
  it("start no worker while the fleet's outside parties are off", async () => {
    servedFleets.delete(FLEET_ID);
    const pool = workers();

    await pool.start({ fleetId: FLEET_ID, name: 'crm' });
    await settled();

    expect([...running]).toEqual([]);
    await pool.stop();
  });

  it("stop one fleet's workers only, once its outside parties go off", async () => {
    const pool = workers();
    await pool.start({ fleetId: FLEET_ID, name: 'crm' });
    await pool.start({ fleetId: OTHER_FLEET_ID, name: 'erp' });
    await settled();

    await pool.stopFleet(FLEET_ID);

    expect([...running]).toEqual(['erp']);
    await pool.stop();
  });

  it("start a fleet's workers again once its outside parties are on again", async () => {
    const pool = workers();
    await pool.start({ fleetId: FLEET_ID, name: 'crm' });
    await settled();
    await pool.stopFleet(FLEET_ID);

    await pool.start({ fleetId: FLEET_ID, name: 'crm' });
    await settled();

    expect([...running]).toEqual(['crm']);
    await pool.stop();
  });
});

describe("a client party's worker, its crew released and the same proxy ship crewed again (vendor platforms V8)", () => {
  const OLD_CREW = 'aeolus_ct_v1_old';
  const NEW_CREW = 'aeolus_ct_v1_new';

  function aCrewedClient(crewToken: string): McpClientParty {
    const { fleetId, state, proxyShipId, secret, requestHash, approvedAt } = aCrewedServer(FLEET_ID, 'agentcore');
    return { fleetId, name: 'agentcore', kind: 'mcpClient', clientId: 'client-agentcore', state, proxyShipId, secret, crewToken, requestId: 'r-agentcore', requestHash, approvedAt };
  }

  it('takes the replies with the new crew token once the fleet refuses the old one', async () => {
    await parties.save(aCrewedClient(OLD_CREW));
    /** The crew tokens the worker took replies with, in turn. */
    const takenWith: (string | null)[] = [];
    const isCrewedAgain = { resolve: (): void => undefined };
    const pool = createPartyWorkers({
      parties,
      stateParty: () => Promise.resolve(ok({ capabilities: [] })),
      stateA2aAgent: () => Promise.resolve(ok({ capabilities: [] })),
      runParty: () => Promise.resolve({ ended: 'stopped' }),
      collectReplies: async ({ party, signal }) => {
        takenWith.push(party.crewToken);
        if (party.crewToken === OLD_CREW) {
          // The old crew token is refused only after the party was crewed again, as when no call waited meanwhile.
          await new Promise<void>((resolve) => {
            isCrewedAgain.resolve = resolve;
          });
          return { ended: 'crewRefused' };
        }
        await new Promise((resolve) => { signal.addEventListener('abort', resolve); });
        return { ended: 'stopped' };
      },
      pushToWebhooks: () => Promise.resolve(),
      servesOutsideParties: () => Promise.resolve(true),
      log: Fastify({ logger: false }).log,
    });
    await pool.start({ fleetId: FLEET_ID, name: 'agentcore' });
    await settled();

    await parties.save(aCrewedClient(NEW_CREW));
    await pool.start({ fleetId: FLEET_ID, name: 'agentcore' });
    isCrewedAgain.resolve();
    await settled();
    await settled();

    expect(takenWith).toEqual([OLD_CREW, NEW_CREW]);
    await pool.stop();
  });
});

describe("an A2A client's worker (decision 0060)", () => {
  it("takes the replies to its calls with its proxy ship's crew token", async () => {
    const { fleetId, state, proxyShipId, secret, requestHash, approvedAt } = aCrewedServer(FLEET_ID, 'supplier');
    await parties.save({ fleetId, name: 'supplier', kind: 'a2aClient', bearerHash: 'h(b)', state, proxyShipId, secret, crewToken: 'aeolus_ct_v1_supplier', requestId: 'r-supplier', requestHash, approvedAt });
    const takenWith: (string | null)[] = [];
    const pool = createPartyWorkers({
      parties,
      stateParty: () => Promise.resolve(ok({ capabilities: [] })),
      stateA2aAgent: () => Promise.resolve(ok({ capabilities: [] })),
      runParty: () => Promise.resolve({ ended: 'stopped' }),
      collectReplies: async ({ party, signal }) => {
        takenWith.push(party.crewToken);
        await new Promise((resolve) => { signal.addEventListener('abort', resolve); });
        return { ended: 'stopped' };
      },
      pushToWebhooks: () => Promise.resolve(),
      servesOutsideParties: () => Promise.resolve(true),
      log: Fastify({ logger: false }).log,
    });

    await pool.start({ fleetId: FLEET_ID, name: 'supplier' });
    await settled();

    expect(takenWith).toEqual(['aeolus_ct_v1_supplier']);
    await pool.stop();
  });
});

describe("an A2A client's worker pushes its tasks' changes (slice 4)", () => {
  it('pushes while it takes the replies, and stops pushing once stopped', async () => {
    const { fleetId, state, proxyShipId, secret, requestHash, approvedAt } = aCrewedServer(FLEET_ID, 'supplier');
    await parties.save({ fleetId, name: 'supplier', kind: 'a2aClient', bearerHash: 'h(b)', state, proxyShipId, secret, crewToken: 'aeolus_ct_v1_supplier', requestId: 'r-supplier', requestHash, approvedAt });
    const pushing = new Set<string>();
    const untilAborted = (signal: AbortSignal) => new Promise((resolve) => { signal.addEventListener('abort', resolve); });
    const pool = createPartyWorkers({
      parties,
      stateParty: () => Promise.resolve(ok({ capabilities: [] })),
      stateA2aAgent: () => Promise.resolve(ok({ capabilities: [] })),
      runParty: () => Promise.resolve({ ended: 'stopped' }),
      collectReplies: async ({ signal }) => {
        await untilAborted(signal);
        return { ended: 'stopped' };
      },
      pushToWebhooks: async ({ caller, signal }) => {
        pushing.add(caller.party);
        await untilAborted(signal);
        pushing.delete(caller.party);
      },
      servesOutsideParties: () => Promise.resolve(true),
      log: Fastify({ logger: false }).log,
    });

    await pool.start({ fleetId: FLEET_ID, name: 'supplier' });
    await settled();
    const whileWorking = [...pushing];
    await pool.stop();

    expect({ whileWorking, after: [...pushing] }).toEqual({ whileWorking: ['supplier'], after: [] });
  });

  it("states an outside A2A agent's proxy ship from its card when its worker starts, then takes its messages until stopped", async () => {
    await parties.save(anAgentParty({ name: 'supplier' }));
    const pool = workers();

    await pool.start({ fleetId: FLEET_ID, name: 'supplier' });
    await settled();
    const whileWorking = [...running];
    await pool.stop();

    expect({ statedAgents, whileWorking, after: [...running] }).toEqual({ statedAgents: ['supplier'], whileWorking: ['supplier'], after: [] });
  });
});
