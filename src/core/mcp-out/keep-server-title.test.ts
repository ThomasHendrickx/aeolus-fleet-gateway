import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { anAttioParty } from '../../../test/support/party-grant-fakes.js';
import { memoryPartyStore } from '../../../test/support/party-fakes.js';
import { createKeepServerTitle } from './keep-server-title.js';

// A party's display name is its MCP server's own serverInfo.title, kept on
// each connect, never its technical name (Thomas, aeolus-fleet#1535).

let parties: ReturnType<typeof memoryPartyStore>;
let keep: ReturnType<typeof createKeepServerTitle>;

beforeEach(async () => {
  parties = memoryPartyStore();
  await parties.save(anAttioParty());
  keep = createKeepServerTitle({ parties });
});

const ATTIO = { url: 'https://mcp.attio.com/mcp', credential: { kind: 'bearer' as const, token: 'access-mathilde' }, party: { fleetId: FLEET_ID, name: 'attio' } };
const displayName = async () => {
  const party = await parties.find(FLEET_ID, 'attio');
  return party?.kind === 'mcpServer' ? party.displayName : undefined;
};

describe("a party's display name, kept from its server's own title", () => {
  it('keeps the title the server gave on connecting', async () => {
    await keep(ATTIO, { title: 'Attio' });

    await expect(displayName()).resolves.toBe('Attio');
  });

  it('keeps none once the server gives no title, so the party reads by its name again', async () => {
    await keep(ATTIO, { title: 'Attio' });
    await keep(ATTIO, { title: null });

    await expect(displayName()).resolves.toBeNull();
  });

  it('keeps nothing for a server checked before it is a party', async () => {
    await keep({ url: ATTIO.url, credential: ATTIO.credential }, { title: 'Attio' });

    await expect(displayName()).resolves.toBeNull();
  });
});
