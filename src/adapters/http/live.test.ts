import { describe, expect, it } from 'vitest';

import { OTHER_FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { createChangeHub } from './live.js';

const FLEET = 'flt_01m3tb1zgr5h2ffee12xnch8sv';

function aHubHeard() {
  const hub = createChangeHub();
  const heard: string[] = [];
  const stop = hub.subscribe({ fleetId: FLEET, read: () => heard.push(FLEET) });
  hub.subscribe({ fleetId: OTHER_FLEET_ID, read: () => heard.push(OTHER_FLEET_ID) });
  return { hub, heard, stop };
}

describe("what hears each change to a person ship's inbox on this gateway (wake a person, #1014)", () => {
  const CHARLOTTE = 'shp_01m3tb1zgr5h2ffee12xnch8pp';
  const MATHILDE = 'shp_01m3tbfspe96yf1rnr4ank9dk1';

  function pagesOfPeople() {
    const hub = createChangeHub();
    const heard: string[] = [];
    hub.subscribe({ fleetId: FLEET, personShipId: CHARLOTTE, read: () => heard.push('charlotte') });
    hub.subscribe({ fleetId: FLEET, personShipId: MATHILDE, read: () => heard.push('mathilde') });
    hub.subscribe({ fleetId: FLEET, read: () => heard.push('argo') });
    hub.subscribe({ fleetId: OTHER_FLEET_ID, personShipId: CHARLOTTE, read: () => heard.push('charlotte elsewhere') });
    return { hub, heard };
  }

  it("tells the pages of that ship's person in its fleet alone", () => {
    const { hub, heard } = pagesOfPeople();

    hub.publish({ fleetId: FLEET, topic: 'inbox', shipId: CHARLOTTE });

    expect(heard).toEqual(['charlotte']);
  });

  it("tells every page of the fleet a change to its requests, a person's too", () => {
    const { hub, heard } = pagesOfPeople();

    hub.publish({ fleetId: FLEET, topic: 'requests' });

    expect(heard).toEqual(['charlotte', 'mathilde', 'argo']);
  });
});

describe("what hears each change to a fleet's requests on this gateway", () => {
  it("tells the listeners of the change's fleet alone", () => {
    const { hub, heard } = aHubHeard();

    hub.publish({ fleetId: FLEET, topic: 'requests' });

    expect(heard).toEqual([FLEET]);
  });

  it('tells every listener to read again when changes may have been missed', () => {
    const { hub, heard } = aHubHeard();

    hub.resync();

    expect(heard).toEqual([FLEET, OTHER_FLEET_ID]);
  });

  it('tells a listener nothing once it stopped listening', () => {
    const { hub, heard, stop } = aHubHeard();
    stop();

    hub.publish({ fleetId: FLEET, topic: 'requests' });

    expect({ heard, listeners: hub.listeners() }).toEqual({ heard: [], listeners: 1 });
  });
});
