import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, memoryConnectionStore, SHIP_ID } from '../../../test/support/fleet-fakes.js';
import { fakeCallSender } from '../../../test/support/mcp-in-fakes.js';
import { JORIS_SHIP_ID, memorySignInNotices } from '../../../test/support/party-grant-fakes.js';
import { createTellSignInNeeded } from './tell-sign-in-needed.js';

const PAGE = 'https://gateway.example.com/outside-parties/attio?fleet=flt_01m3tb1zgr5h2ffee12xnch8sv';

let sender: ReturnType<typeof fakeCallSender>;
let notices: ReturnType<typeof memorySignInNotices>;
let tell: ReturnType<typeof createTellSignInNeeded>;
let issued: number;

beforeEach(async () => {
  sender = fakeCallSender();
  notices = memorySignInNotices();
  issued = 0;
  const connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: new Date('2026-10-25T09:00:00.000Z') });
  tell = createTellSignInNeeded({
    notices,
    connections,
    sender,
    newNoticeId: () => {
      issued += 1;
      return `notice-${String(issued)}`;
    },
    pageUrlOf: (fleetId, party) => `https://gateway.example.com/outside-parties/${party}?fleet=${fleetId}`,
  });
});

const tellJoris = () => tell({ fleetId: FLEET_ID, party: 'attio', personShipId: JORIS_SHIP_ID, lost: null });

describe('the person whose sign-in a call needs is told once per party (decision 0067, Q6, Q9)', () => {
  it('sends their person ship a text message from the gateway\'s ship with the page to sign in on', async () => {
    await tellJoris();

    expect(sender.sent).toEqual([
      {
        crewToken: 'aeolus_ct_v1_gateway',
        to: JORIS_SHIP_ID,
        contentType: 'text/plain',
        payload: `A ship of yours called attio, which calls under each person's own sign-in, and you are not signed in to it. Sign in on ${PAGE}; until then your ships' calls to attio are refused.`,
        idempotencyKey: 'party-sign-in:notice-1',
      },
    ]);
  });

  it('tells them their sign-in ended, with why, when their grant was lost (scenario 19)', async () => {
    await tell({ fleetId: FLEET_ID, party: 'attio', personShipId: JORIS_SHIP_ID, lost: { at: new Date('2026-10-28T16:00:00.000Z'), why: 'invalid_grant: the refresh token is revoked' } });

    expect(sender.sent).toMatchObject([
      {
        to: JORIS_SHIP_ID,
        contentType: 'text/plain',
        payload: `Your sign-in to attio ended: attio refused to refresh it (invalid_grant: the refresh token is revoked). Sign in again on ${PAGE}; until then your ships' calls to attio are refused.`,
      },
    ]);
  });

  it('sends no second message while they have not signed in (scenario 13)', async () => {
    await tellJoris();

    await tellJoris();

    expect(sender.sent).toHaveLength(1);
  });

  it('tells them again after a sign-in in between (scenario 9)', async () => {
    await tellJoris();
    await notices.close(FLEET_ID, { party: 'attio', personShipId: JORIS_SHIP_ID });

    await tellJoris();

    expect(sender.sent.map(({ idempotencyKey }) => idempotencyKey)).toEqual(['party-sign-in:notice-1', 'party-sign-in:notice-2']);
  });

  it('tells them at the next call when the fleet did not answer, under the same key, so it is stored once', async () => {
    sender.state.refusal = { code: 'UNAVAILABLE', message: 'The fleet did not answer' };
    await tellJoris();
    sender.state.refusal = undefined;

    await tellJoris();
    await tellJoris();

    expect(sender.sent.map(({ idempotencyKey }) => idempotencyKey)).toEqual(['party-sign-in:notice-1']);
  });

  it('tries no more once the fleet refused the message', async () => {
    sender.state.refusal = { code: 'FORBIDDEN', message: 'joris is outside the gateway\'s reach' };
    await tellJoris();
    sender.state.refusal = undefined;

    await tellJoris();

    expect(sender.sent).toEqual([]);
  });
});
