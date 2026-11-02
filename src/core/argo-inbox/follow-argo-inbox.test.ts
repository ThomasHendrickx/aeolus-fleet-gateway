import { beforeEach, describe, expect, it } from 'vitest';

import { anArgoEntry, ARGO_SHIP_ID, DONE_AT, fakeArgoInboxFleet, MATHILDE_ACCOUNT_ID } from '../../../test/support/argo-inbox-fakes.js';
import { FLEET_ID, memoryConnectionStore, OTHER_FLEET_ID, SHIP_ID } from '../../../test/support/fleet-fakes.js';
import { createFollowArgoInbox } from './follow-argo-inbox.js';

// The gateway's own ship reads argo's open inbox by a read rule argo adds
// (argo's inbox, AI9): it reads it whole, then follows each change to it,
// and reads it whole again on a restart. argo's inbox stays the one record:
// the gateway keeps no copy, and core sends it nothing.

const CREWED_AT = new Date('2026-11-01T08:00:00.000Z');

let connections: ReturnType<typeof memoryConnectionStore>;
let fleet: ReturnType<typeof fakeArgoInboxFleet>;

beforeEach(async () => {
  connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: CREWED_AT });
  fleet = fakeArgoInboxFleet();
});

const signal = new AbortController().signal;

/** The fleets whose argo inbox the gateway saw change, in order. */
let changed: string[];

beforeEach(() => {
  changed = [];
});

function following() {
  return createFollowArgoInbox({
    connections,
    door: fleet.door,
    onChanged: (fleetId) => {
      changed.push(fleetId);
    },
  });
}

/** The messages open at argo as the gateway read them, by message. */
function openAt(follow: ReturnType<typeof following>) {
  const inbox = follow.inboxOf(FLEET_ID);
  return inbox?.kind === 'read' ? inbox.messages.map(({ messageId }) => messageId) : inbox;
}

describe("the gateway's ship reading argo's inbox", () => {
  it('reads every message open at argo, none done', async () => {
    fleet.send(anArgoEntry(1));
    fleet.send(anArgoEntry(2, { deliveryState: 'acknowledged' }));
    fleet.send(anArgoEntry(3, { deliveryState: 'handed' }));
    const follow = following();

    await follow.round(signal);

    expect(openAt(follow)).toEqual([anArgoEntry(1).messageId, anArgoEntry(3).messageId]);
  });

  it('sees a new message to argo', async () => {
    const follow = following();
    await follow.round(signal);

    fleet.send(anArgoEntry(1));
    await follow.round(signal);

    expect(follow.inboxOf(FLEET_ID)).toEqual({
      kind: 'read',
      argo: ARGO_SHIP_ID,
      messages: [{ messageId: anArgoEntry(1).messageId, deliveryId: anArgoEntry(1).deliveryId, sender: anArgoEntry(1).sender, contentType: 'text/markdown', sentAt: anArgoEntry(1).sentAt, title: 'Report 001 to argo', askedQuestionId: null, withdrawnQuestionId: null }],
      lastDone: null,
    });
  });

  it('sees a message done in the console as done', async () => {
    fleet.send(anArgoEntry(1));
    fleet.send(anArgoEntry(2));
    const follow = following();
    await follow.round(signal);

    fleet.markDone(anArgoEntry(1).messageId);
    await follow.round(signal);

    expect(openAt(follow)).toEqual([anArgoEntry(2).messageId]);
  });

  it("titles each message as an inbox does, a question by its title, any other by its first line cut to 80 characters", async () => {
    const longLine = `thomas-mac is low on disk: ${'x'.repeat(80)}`;
    fleet.send(anArgoEntry(1, { contentType: 'application/vnd.aeolus.question+json', headline: 'Which repository holds the memory plugin?', askedQuestionId: 'b3f1c6a2-0d7e-4c55-9a51-6f0e4e2d9a11' }));
    fleet.send(anArgoEntry(2, { payload: `${longLine}\nThe rest of the report` }));
    const follow = following();

    await follow.round(signal);

    const inbox = follow.inboxOf(FLEET_ID);
    expect(inbox?.kind === 'read' ? inbox.messages.map(({ title, askedQuestionId }) => ({ title, askedQuestionId })) : inbox).toEqual([
      { title: 'Which repository holds the memory plugin?', askedQuestionId: 'b3f1c6a2-0d7e-4c55-9a51-6f0e4e2d9a11' },
      { title: `${longLine.slice(0, 79)}…`, askedQuestionId: null },
    ]);
  });

  it('keeps the newest message done at argo: its title, when, and who did it, signed in as argo', async () => {
    fleet.send(anArgoEntry(1, { payload: 'thomas-mac is low on disk: 4% free' }));
    fleet.send(anArgoEntry(2));
    const follow = following();
    await follow.round(signal);

    fleet.markDone(anArgoEntry(1).messageId);
    await follow.round(signal);

    const inbox = follow.inboxOf(FLEET_ID);
    expect(inbox?.kind === 'read' ? inbox.lastDone : inbox).toEqual({ title: 'thomas-mac is low on disk: 4% free', at: DONE_AT, byShipId: ARGO_SHIP_ID, signedInAccountId: MATHILDE_ACCOUNT_ID });
  });

  it("tells each change to argo's open inbox, and none while it did not change", async () => {
    fleet.send(anArgoEntry(1));
    const follow = following();
    await follow.round(signal);
    await follow.round(signal);
    const unchanged = [...changed];

    fleet.markDone(anArgoEntry(1).messageId);
    await follow.round(signal);

    expect({ unchanged, then: changed }).toEqual({ unchanged: [FLEET_ID], then: [FLEET_ID, FLEET_ID] });
  });

  it('keeps when a message was done at argo and by which account signed in as argo', async () => {
    fleet.send(anArgoEntry(1));
    const follow = following();
    await follow.round(signal);

    fleet.markDone(anArgoEntry(1).messageId, { at: new Date('2026-11-01T20:14:00.000Z'), signedInAccountId: 'acc-mathilde' });
    await follow.round(signal);

    expect(follow.doneAtArgo(FLEET_ID, anArgoEntry(1).messageId)).toEqual({ at: new Date('2026-11-01T20:14:00.000Z'), accountId: 'acc-mathilde' });
  });

  it('knows nothing of who did a message it did not see done, as one done while the gateway was down', async () => {
    fleet.send(anArgoEntry(1));
    await following().round(signal);
    fleet.markDone(anArgoEntry(1).messageId, { signedInAccountId: 'acc-mathilde' });

    const restarted = following();
    await restarted.round(signal);

    expect(restarted.doneAtArgo(FLEET_ID, anArgoEntry(1).messageId)).toBeUndefined();
  });

  it('reads the open inbox again whole on a restart and loses nothing, what came while it was down included', async () => {
    fleet.send(anArgoEntry(1));
    fleet.send(anArgoEntry(2));
    await following().round(signal);
    fleet.send(anArgoEntry(3));
    fleet.markDone(anArgoEntry(1).messageId);

    const restarted = following();
    await restarted.round(signal);

    expect(openAt(restarted)).toEqual([anArgoEntry(2).messageId, anArgoEntry(3).messageId]);
  });

  it('reads nothing while argo has not added the read rule, and says so', async () => {
    fleet.state.isReadRuleOn = false;
    fleet.send(anArgoEntry(1));
    const follow = following();

    await follow.round(signal);

    expect({ inbox: follow.inboxOf(FLEET_ID), wholeReads: fleet.state.wholeReads }).toEqual({ inbox: { kind: 'notLetRead' }, wholeReads: 0 });
  });

  it('reads nothing more once argo removes the read rule', async () => {
    fleet.send(anArgoEntry(1));
    const follow = following();
    await follow.round(signal);

    fleet.state.isReadRuleOn = false;
    await follow.round(signal);

    expect(follow.inboxOf(FLEET_ID)).toEqual({ kind: 'notLetRead' });
  });

  it('reads the open inbox whole again once argo adds the rule back, as it followed nothing meanwhile', async () => {
    const follow = following();
    await follow.round(signal);
    fleet.state.isReadRuleOn = false;
    await follow.round(signal);

    fleet.send(anArgoEntry(1));
    fleet.state.isReadRuleOn = true;
    await follow.round(signal);

    expect(openAt(follow)).toEqual([anArgoEntry(1).messageId]);
  });

  it('keeps what it read while the fleet does not answer, and follows on from there once it does', async () => {
    fleet.send(anArgoEntry(1));
    const follow = following();
    await follow.round(signal);

    fleet.state.isAnswering = false;
    await follow.round(signal);
    const meanwhile = openAt(follow);
    fleet.state.isAnswering = true;
    fleet.send(anArgoEntry(2));
    await follow.round(signal);

    expect({ meanwhile, then: openAt(follow) }).toEqual({ meanwhile: [anArgoEntry(1).messageId], then: [anArgoEntry(1).messageId, anArgoEntry(2).messageId] });
  });

  it('knows nothing of a fleet it is not connected to', async () => {
    const follow = following();

    await follow.round(signal);

    expect(follow.inboxOf(OTHER_FLEET_ID)).toBeUndefined();
  });
});
