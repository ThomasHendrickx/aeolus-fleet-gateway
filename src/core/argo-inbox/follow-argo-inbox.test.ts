import { beforeEach, describe, expect, it } from 'vitest';

import { anArgoEntry, fakeArgoInboxFleet } from '../../../test/support/argo-inbox-fakes.js';
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

function following() {
  return createFollowArgoInbox({ connections, door: fleet.door });
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

    expect(follow.inboxOf(FLEET_ID)).toEqual({ kind: 'read', messages: [{ messageId: anArgoEntry(1).messageId, deliveryId: anArgoEntry(1).deliveryId, sender: anArgoEntry(1).sender, contentType: 'text/markdown', sentAt: anArgoEntry(1).sentAt }] });
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
