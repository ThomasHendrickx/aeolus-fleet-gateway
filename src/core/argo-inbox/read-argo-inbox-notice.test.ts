import { beforeEach, describe, expect, it } from 'vitest';

import { anArgoEntry, fakeArgoInboxFleet, memoryArgoAccounts } from '../../../test/support/argo-inbox-fakes.js';
import { FLEET_ID, memoryConnectionStore, SHIP_ID } from '../../../test/support/fleet-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { createFollowArgoInbox } from './follow-argo-inbox.js';
import { createReadArgoInboxNotice } from './read-argo-inbox-notice.js';

// While argo has not added the read rule, nothing of argo's reaches the
// people allowed as argo; the gateway's overview tells them so, and where
// argo adds the rule (argo's inbox, section 4, unhappy paths).

const CHARLOTTE = { fleetId: FLEET_ID, accountId: 'acc-charlotte' };
const signal = new AbortController().signal;

let connections: ReturnType<typeof memoryConnectionStore>;
let accounts: ReturnType<typeof memoryArgoAccounts>;
let fleet: ReturnType<typeof fakeArgoInboxFleet>;
let follow: ReturnType<typeof createFollowArgoInbox>;

beforeEach(async () => {
  connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: new Date('2026-11-01T08:00:00.000Z') });
  accounts = memoryArgoAccounts();
  await accounts.keep(FLEET_ID, { accountId: 'acc-charlotte', personShipId: PERSON_SHIP_ID });
  fleet = fakeArgoInboxFleet();
  follow = createFollowArgoInbox({ connections, door: fleet.door });
});

function readNotice() {
  return createReadArgoInboxNotice({ accounts, inboxOf: follow.inboxOf, connections })(CHARLOTTE);
}

describe("the overview's notice of argo's read rule", () => {
  it('reads nothing with no rule and tells an account allowed as argo so, with where argo adds the rule', async () => {
    fleet.state.isReadRuleOn = false;
    fleet.send(anArgoEntry(1));
    await follow.round(signal);

    await expect(readNotice()).resolves.toEqual({ kind: 'notLetRead', gatewayShip: { shipId: SHIP_ID, name: 'gateway' } });
  });

  it('tells an account not allowed as argo nothing', async () => {
    fleet.state.isReadRuleOn = false;
    await follow.round(signal);
    await accounts.drop(FLEET_ID, 'acc-charlotte');

    await expect(readNotice()).resolves.toEqual({ kind: 'none' });
  });

  it('tells nothing while the gateway reads argo by the rule', async () => {
    await follow.round(signal);

    await expect(readNotice()).resolves.toEqual({ kind: 'none' });
  });

  it('tells nothing before the gateway first asked the fleet, as it does not know yet', async () => {
    await expect(readNotice()).resolves.toEqual({ kind: 'none' });
  });
});
