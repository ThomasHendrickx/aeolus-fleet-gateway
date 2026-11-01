/**
 * The places besides Bridge that show a person's item (Bridge, section 8):
 * as routing per job has them and the gateway offers them, in routing's
 * order; the gateway's own step in Bridge alone.
 */
import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { ConnectionStore } from '../connection/ports.js';
import { ownStepsInBridgeOnly, ROUTING_PLACES, routingOf, type RoutedItem, type Routing, type RoutingDefaults, type RoutingPlace, type Routes } from './routing.js';
import { isOfferedPlace } from './turn-route.js';

/** What the gateway offers of the places routing names. */
export interface PlacesOffered {
  isEmailOffered: boolean;
  isWebPushOffered: boolean;
}

/** What reading an item's places needs: the person's routes with the gateway's defaults, its own ship, and the places it offers. */
export interface PlacesDeps extends PlacesOffered {
  connections: Pick<ConnectionStore, 'binding'>;
  routes: Routes;
  defaults: RoutingDefaults;
}

/** The places besides Bridge that show an item, by a routing, in routing's order. */
export function placesOf(routing: Routing, offered: PlacesOffered): (item: RoutedItem) => RoutingPlace[] {
  return (item) => ROUTING_PLACES.filter((place) => isOfferedPlace(place, offered) && routing.isShowing(place, item));
}

/** The places that show each item of a person ship, read once for the ship. */
export async function showingInOf(deps: PlacesDeps, ship: { fleetId: FleetId; shipId: ShipId }): Promise<(item: RoutedItem) => RoutingPlace[]> {
  const [routes, gateway] = await Promise.all([deps.routes.list(ship), deps.connections.binding(ship.fleetId)]);
  return placesOf(ownStepsInBridgeOnly(routingOf(routes, deps.defaults), gateway?.shipId), deps);
}
