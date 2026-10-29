import { describe, expect, it } from 'vitest';

import { err, ok } from '../../core/shared/result.js';
import { PROXY_SHIP_ID } from '../../../test/support/party-fakes.js';
import { logRefusedFacts } from './logged-verified-facts.js';

// A verified facts write the fleet refuses takes nothing from the approval
// (decision 0059), so the gateway logs it: in a fleet that applies its own
// network rules, the gateway's ship has no manage reach over its proxy ships.

const FACTS = [{ checked: 'tlsHost', value: 'crm.example.com' }] as const;

function aLog() {
  const warned: unknown[] = [];
  return { warned, log: { warn: (fields: unknown, message: string) => warned.push([fields, message]) } };
}

describe("the gateway's verified facts writes", () => {
  it('logs a refused write as a warning, with the ship and why, and answers the refusal', async () => {
    const { warned, log } = aLog();
    const refusal = { code: 'FORBIDDEN', message: 'The network rules do not allow this manage' };

    const set = await logRefusedFacts({ setVerifiedFacts: () => Promise.resolve(err(refusal)) }, log).setVerifiedFacts('aeolus_ct_v1_gateway', { shipId: PROXY_SHIP_ID, facts: FACTS });

    expect({ set, warned }).toEqual({ set: err(refusal), warned: [[{ shipId: PROXY_SHIP_ID, code: 'FORBIDDEN', reason: refusal.message }, 'the fleet refused the verified facts about a proxy ship']] });
  });

  it('logs nothing for a write the fleet took', async () => {
    const { warned, log } = aLog();

    await logRefusedFacts({ setVerifiedFacts: () => Promise.resolve(ok(undefined)) }, log).setVerifiedFacts('aeolus_ct_v1_gateway', { shipId: PROXY_SHIP_ID, facts: FACTS });

    expect(warned).toEqual([]);
  });
});
