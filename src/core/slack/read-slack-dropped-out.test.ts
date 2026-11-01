import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { memoryRoutes } from '../../../test/support/people-fakes.js';
import { aSlackApp, aSlackLink, memorySlackApps, memorySlackLinks } from '../../../test/support/slack-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import { routingDefaultsOf } from '../people/routing.js';
import { createReadSlackDroppedOut } from './read-slack-dropped-out.js';

// A place fails (Bridge, section 9): the fleet's own bot removed in Slack,
// Slack drops out, and Bridge says why: "Slack dropped out" (states.html).

const MATHILDE: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc-mathilde', personShipId: 'shp_01m3tbfspe96yf1rnr4ank9m4t', accountToken: 'account-token-1', scopes: [] };
const REMOVED_AT = new Date('2026-10-31T19:40:00.000Z');

let apps: ReturnType<typeof memorySlackApps>;
let links: ReturnType<typeof memorySlackLinks>;
let routes: ReturnType<typeof memoryRoutes>;

beforeEach(async () => {
  apps = memorySlackApps();
  links = memorySlackLinks();
  routes = memoryRoutes();
  await apps.save(aSlackApp({ name: 'Aeolus fleet', bot: null, removedInSlackAt: REMOVED_AT }));
  await links.add(aSlackLink());
});

function readSlackDroppedOut({ actor = MATHILDE, isSlackOnByDefault = true }: { actor?: Actor; isSlackOnByDefault?: boolean } = {}) {
  const defaults = routingDefaultsOf(isSlackOnByDefault ? [{ job: 'decide', place: 'slack' }] : []);
  return createReadSlackDroppedOut({ apps, links, routes, defaults })({ actor });
}

describe('Slack dropped out, said in Bridge', () => {
  it("says the fleet's own bot was removed in Slack, by its name, to a linked person with Slack on for a job", async () => {
    await expect(readSlackDroppedOut()).resolves.toEqual({ botName: 'Aeolus fleet' });
  });

  it('says it for a job the person turned Slack on for themselves', async () => {
    await routes.save({ fleetId: FLEET_ID, shipId: 'shp_01m3tbfspe96yf1rnr4ank9m4t', job: 'stay-aware', place: 'slack', isOn: true, changedAt: new Date('2026-10-30T10:00:00.000Z') });

    await expect(readSlackDroppedOut({ isSlackOnByDefault: false })).resolves.toEqual({ botName: 'Aeolus fleet' });
  });

  it("says nothing while the fleet's own bot is in Slack", async () => {
    await apps.save(aSlackApp({ name: 'Aeolus fleet', bot: { token: 'xoxb-A01', userId: 'U0A01' } }));

    await expect(readSlackDroppedOut()).resolves.toBeNull();
  });

  it('says nothing while Slack is off for every job of the person', async () => {
    await routes.save({ fleetId: FLEET_ID, shipId: 'shp_01m3tbfspe96yf1rnr4ank9m4t', job: 'decide', place: 'slack', isOn: false, changedAt: new Date('2026-10-30T10:00:00.000Z') });

    await expect(readSlackDroppedOut()).resolves.toBeNull();
  });

  it('says nothing to a person who never linked Slack, where it showed them nothing', async () => {
    await links.remove(FLEET_ID, 'acc-mathilde');

    await expect(readSlackDroppedOut()).resolves.toBeNull();
  });

  it('says nothing where the fleet has no bot of its own in Slack', async () => {
    await expect(createReadSlackDroppedOut({ apps: memorySlackApps(), links, routes, defaults: routingDefaultsOf([{ job: 'decide', place: 'slack' }]) })({ actor: MATHILDE })).resolves.toBeNull();
  });

  it('says nothing to an account with no person ship in the fleet', async () => {
    await expect(readSlackDroppedOut({ actor: { ...MATHILDE, personShipId: null } })).resolves.toBeNull();
  });
});
