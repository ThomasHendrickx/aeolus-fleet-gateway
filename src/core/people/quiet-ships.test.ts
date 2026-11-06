import { QUESTION_CONTENT_TYPE, type ShipId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { withQuietShips, type QuietShip } from './quiet-ships.js';
import { routingDefaultsOf, routingOf } from './routing.js';

// Quiet ships (preferences design): a quiet ship never wakes the person,
// through web push or email, for any job; Slack and a chat are places, not
// wakes, so their switches stand. Woken again, a ship wakes only for what it
// sends after.

const BUSY_SHIP: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9trk';
const OTHER_SHIP: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0oth';
const CHANGED_AT = new Date('2026-11-06T12:00:00.000Z');
const BEFORE = new Date('2026-11-06T11:59:59.999Z');

const EVERYWHERE = routingOf([], routingDefaultsOf((['web-push', 'email', 'slack', 'chat'] as const).map((place) => ({ job: 'decide' as const, place }))));

function aQuietShip(overrides: Partial<QuietShip> = {}): QuietShip {
  return { fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, quietShipId: BUSY_SHIP, name: 'watcher', isQuiet: true, changedAt: CHANGED_AT, ...overrides };
}

const aQuestion = (senderShipId: ShipId, sentAt = CHANGED_AT) => ({ contentType: QUESTION_CONTENT_TYPE, sentAt, senderShipId });

describe('quiet ships', () => {
  it('wake nobody through web push or email', () => {
    const routing = withQuietShips(EVERYWHERE, [aQuietShip()]);
    expect([routing.isShowing('web-push', aQuestion(BUSY_SHIP)), routing.isShowing('email', aQuestion(BUSY_SHIP))]).toEqual([false, false]);
  });

  it('still show in Slack and a chat, as those places are routed', () => {
    const routing = withQuietShips(EVERYWHERE, [aQuietShip()]);
    expect([routing.isShowing('slack', aQuestion(BUSY_SHIP)), routing.isShowing('chat', aQuestion(BUSY_SHIP))]).toEqual([true, true]);
  });

  it('leave every other ship waking as routed', () => {
    expect(withQuietShips(EVERYWHERE, [aQuietShip()]).isShowing('web-push', aQuestion(OTHER_SHIP))).toBe(true);
  });

  it('woken again, wake for what they send from then on', () => {
    expect(withQuietShips(EVERYWHERE, [aQuietShip({ isQuiet: false })]).isShowing('web-push', aQuestion(BUSY_SHIP, CHANGED_AT))).toBe(true);
  });

  it('woken again, never wake for what they sent before', () => {
    expect(withQuietShips(EVERYWHERE, [aQuietShip({ isQuiet: false })]).isShowing('email', aQuestion(BUSY_SHIP, BEFORE))).toBe(false);
  });
});
