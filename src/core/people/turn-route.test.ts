import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { CHARLOTTE_GRANT, fakeCrewPersonShip, memoryPersonCrews, memoryRoutes } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { ok } from '../shared/result.js';
import { createReadRouting } from './read-routing.js';
import { routingDefaultsOf } from './routing.js';
import { createTurnRoute } from './turn-route.js';

// A person turns a place on or off for a job (Bridge, section 8): the
// change is kept by fleet, person ship, job and place, and applies at once.
// Bridge's routing page reads every job's places, the defaults where the
// person chose nothing (CC19).

const NOW = new Date('2026-11-01T09:00:00.000Z');
const LATER = new Date('2026-11-01T10:00:00.000Z');
const DEFAULTS = routingDefaultsOf([
  { job: 'decide', place: 'chat' },
  { job: 'do', place: 'chat' },
  { job: 'stay-aware', place: 'chat' },
  { job: 'everything-else', place: 'chat' },
]);

let crews: ReturnType<typeof memoryPersonCrews>;
let routes: ReturnType<typeof memoryRoutes>;

beforeEach(() => {
  crews = memoryPersonCrews();
  routes = memoryRoutes();
});

function turnRoute(options: { isEmailOffered?: boolean; isWebPushOffered?: boolean; at?: Date } = {}) {
  return createTurnRoute({ crewPersonShip: fakeCrewPersonShip(crews), routes, defaults: DEFAULTS, isEmailOffered: options.isEmailOffered ?? true, isWebPushOffered: options.isWebPushOffered ?? true, clock: { now: () => options.at ?? NOW } });
}

function readRouting() {
  return createReadRouting({ crewPersonShip: fakeCrewPersonShip(crews), routes, defaults: DEFAULTS, isEmailOffered: true, isWebPushOffered: false });
}

describe('a person turns a place on or off for a job', () => {
  it('keeps it for their own person ship, with when it was turned', async () => {
    const turned = await turnRoute()({ caller: CHARLOTTE_GRANT, job: 'decide', place: 'slack', isOn: true });

    expect({ turned, held: routes.held }).toEqual({ turned: ok(undefined), held: [{ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, job: 'decide', place: 'slack', isOn: true, changedAt: NOW }] });
  });

  it('turns a place on by default off', async () => {
    await turnRoute()({ caller: CHARLOTTE_GRANT, job: 'stay-aware', place: 'chat', isOn: false });

    expect(routes.held.map(({ job, place, isOn }) => ({ job, place, isOn }))).toEqual([{ job: 'stay-aware', place: 'chat', isOn: false }]);
  });

  it('keeps when a place was turned on when it is turned on again, so a push place still shows what arrived since', async () => {
    await turnRoute()({ caller: CHARLOTTE_GRANT, job: 'decide', place: 'slack', isOn: true });

    await turnRoute({ at: LATER })({ caller: CHARLOTTE_GRANT, job: 'decide', place: 'slack', isOn: true });

    expect(routes.held.map(({ changedAt }) => changedAt)).toEqual([NOW]);
  });

  it('keeps nothing when the place is already as the default has it', async () => {
    await turnRoute()({ caller: CHARLOTTE_GRANT, job: 'decide', place: 'chat', isOn: true });

    expect(routes.held).toEqual([]);
  });

  it('refuses to turn email on where the gateway sends no email, keeping nothing', async () => {
    const turned = await turnRoute({ isEmailOffered: false })({ caller: CHARLOTTE_GRANT, job: 'decide', place: 'email', isOn: true });

    expect({ kind: turned.isOk ? undefined : turned.error.kind, held: routes.held }).toEqual({ kind: 'PLACE_NOT_OFFERED', held: [] });
  });

  it('refuses to turn web push on where the gateway holds no push keys, keeping nothing', async () => {
    const turned = await turnRoute({ isWebPushOffered: false })({ caller: CHARLOTTE_GRANT, job: 'stay-aware', place: 'web-push', isOn: true });

    expect({ kind: turned.isOk ? undefined : turned.error.kind, held: routes.held }).toEqual({ kind: 'PLACE_NOT_OFFERED', held: [] });
  });

  it('is refused without a person ship, keeping nothing', async () => {
    const turned = await turnRoute()({ caller: { fleetId: FLEET_ID, grantId: 'grant-of-argo' }, job: 'decide', place: 'slack', isOn: true });

    expect({ kind: turned.isOk ? undefined : turned.error.kind, held: routes.held }).toEqual({ kind: 'NOT_A_PERSON', held: [] });
  });
});

describe("Bridge's routing page reads where each job shows", () => {
  it('reads the defaults where the person chose nothing, and their own choices over them, with the places the gateway offers', async () => {
    await turnRoute()({ caller: CHARLOTTE_GRANT, job: 'decide', place: 'slack', isOn: true });
    await turnRoute()({ caller: CHARLOTTE_GRANT, job: 'stay-aware', place: 'chat', isOn: false });

    const read = await readRouting()(CHARLOTTE_GRANT);

    expect(read).toEqual(
      ok({
        offered: { slack: true, chat: true, 'web-push': false, email: true },
        jobs: [
          { job: 'decide', places: { slack: true, chat: true, 'web-push': false, email: false } },
          { job: 'do', places: { slack: false, chat: true, 'web-push': false, email: false } },
          { job: 'stay-aware', places: { slack: false, chat: false, 'web-push': false, email: false } },
          { job: 'everything-else', places: { slack: false, chat: true, 'web-push': false, email: false } },
        ],
      }),
    );
  });

  it('is refused without a person ship', async () => {
    const read = await readRouting()({ fleetId: FLEET_ID, grantId: 'grant-of-argo' });

    expect(read.isOk ? undefined : read.error.kind).toBe('NOT_A_PERSON');
  });
});
