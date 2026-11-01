import { ALERT_CONTENT_TYPE, QUESTION_CONTENT_TYPE } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { routingDefaultsOf, routingOf, type Route } from './routing.js';

// Routing per job (docs/design/bridge, section 8): per fleet, person ship,
// job and place, on or off, defaults from the gateway's configuration (CC5,
// CC19). A pull place turned on shows every item of the job; a push place
// only what arrives after (CC20).

const TURNED_ON_AT = new Date('2026-11-01T12:00:00.000Z');
const DEFAULTS = routingDefaultsOf([{ job: 'decide', place: 'chat' }]);

function aRoute(overrides: Partial<Route> = {}): Route {
  return { fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, job: 'decide', place: 'slack', isOn: true, changedAt: TURNED_ON_AT, ...overrides };
}

const aQuestion = (sentAt: Date) => ({ contentType: QUESTION_CONTENT_TYPE, sentAt });

describe('routing per job', () => {
  it('is on for a job and place the defaults turn on, and off for the rest', () => {
    const routing = routingOf([], DEFAULTS);
    expect([routing.isOn('decide', 'chat'), routing.isOn('decide', 'slack'), routing.isOn('stay-aware', 'chat')]).toEqual([true, false, false]);
  });

  it("takes the person's own choice over the default, either way", () => {
    const routing = routingOf([aRoute({ place: 'chat', isOn: false }), aRoute({ place: 'email' })], DEFAULTS);
    expect([routing.isOn('decide', 'chat'), routing.isOn('decide', 'email')]).toEqual([false, true]);
  });

  it('shows in a pull place every item of a job on, whenever it arrived', () => {
    const routing = routingOf([aRoute({ place: 'chat', job: 'stay-aware' })], DEFAULTS);
    expect(routing.isShowing('chat', { contentType: ALERT_CONTENT_TYPE, sentAt: new Date('2026-10-01T00:00:00.000Z') })).toBe(true);
  });

  it('shows in a push place only what arrived since it was turned on for the job, from the moment itself', () => {
    const routing = routingOf([aRoute()], DEFAULTS);
    expect([routing.isShowing('slack', aQuestion(new Date(TURNED_ON_AT.getTime() - 1))), routing.isShowing('slack', aQuestion(TURNED_ON_AT))]).toEqual([false, true]);
  });

  it('shows in a push place the defaults turn on whatever arrived, as it was never turned on later', () => {
    const routing = routingOf([], routingDefaultsOf([{ job: 'decide', place: 'email' }]));
    expect(routing.isShowing('email', aQuestion(new Date('2026-01-01T00:00:00.000Z')))).toBe(true);
  });

  it('shows nothing of a job in a place turned off', () => {
    const routing = routingOf([aRoute({ isOn: false })], DEFAULTS);
    expect(routing.isShowing('slack', aQuestion(new Date('2026-12-01T00:00:00.000Z')))).toBe(false);
  });

  it('knows each item by its job: a plain message is everything else', () => {
    const routing = routingOf([aRoute({ job: 'everything-else', place: 'chat' })], routingDefaultsOf([]));
    expect([routing.isShowing('chat', { contentType: 'text/plain', sentAt: TURNED_ON_AT }), routing.isShowing('chat', aQuestion(TURNED_ON_AT))]).toEqual([true, false]);
  });
});
