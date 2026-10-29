import { describe, expect, it } from 'vitest';

import { anAgentParty } from '../../../test/support/a2a-agent-fakes.js';
import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { memoryPartyStore, memoryScopeRequirements } from '../../../test/support/party-fakes.js';
import { createReadScopeRequirements } from './read-scope-requirements.js';

describe("anyone in the fleet reads which scopes an outside party needs, and the version to change them on", () => {
  it('reads the requirements as they are now', async () => {
    const parties = memoryPartyStore();
    await parties.save(anAgentParty());
    const requirements = memoryScopeRequirements();
    await requirements.change({ fleetId: FLEET_ID, name: 'supplier' }, { version: 0, party: ['supplier:quote'], tools: new Map() });

    await expect(createReadScopeRequirements({ parties, requirements })({ fleetId: FLEET_ID, name: 'supplier' })).resolves.toEqual({ isOk: true, value: { version: 1, party: ['supplier:quote'], tools: new Map() } });
  });

  it('refuses a party that is neither an outside MCP server nor an A2A agent', async () => {
    await expect(createReadScopeRequirements({ parties: memoryPartyStore(), requirements: memoryScopeRequirements() })({ fleetId: FLEET_ID, name: 'claude' })).resolves.toEqual({
      isOk: false,
      error: { kind: 'NO_SUCH_PARTY', message: 'There is no outside MCP server or A2A agent claude' },
    });
  });
});
