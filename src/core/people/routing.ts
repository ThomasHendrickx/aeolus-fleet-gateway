/**
 * Routing per job (docs/design/bridge, section 8): per fleet, person ship,
 * job and place, whether the place shows the job's items besides Bridge,
 * which always does. The person's own choice counts over the default from
 * the gateway's configuration (CC5, CC19). A pull place, a chat, is a view:
 * turned on, it shows every item of the job. A push place, Slack or a wake,
 * shows only what arrives after it was turned on for the job (CC20).
 */
import type { FleetId, ShipId } from '@aeolus-fleet/common';

import { jobOf, type ItemJob } from './item-job.js';
import type { PersonShip } from './ports.js';

/** The places a person routes a job to besides Bridge (CC5). */
export type RoutingPlace = 'slack' | 'chat' | 'web-push' | 'email';

export const ITEM_JOBS: readonly ItemJob[] = ['decide', 'do', 'stay-aware', 'everything-else'];
export const ROUTING_PLACES: readonly RoutingPlace[] = ['slack', 'chat', 'web-push', 'email'];

/** A person's own choice for one job and place, with when they made it. */
export interface Route {
  readonly fleetId: FleetId;
  readonly shipId: ShipId;
  readonly job: ItemJob;
  readonly place: RoutingPlace;
  readonly isOn: boolean;
  readonly changedAt: Date;
}

/** The jobs and places on while a person made no choice of their own, from the gateway's configuration (CC19). */
export interface RoutingDefaults {
  readonly onByDefault: ReadonlySet<string>;
}

/** Outbound port: each person's own choices, by fleet and person ship. */
export interface Routes {
  list(ship: PersonShip): Promise<Route[]>;
  /** Keeps it, or keeps it anew for its job and place. */
  save(route: Route): Promise<void>;
}

/** An item as routing reads it: its content type names its job, and who sent it. */
export interface RoutedItem {
  readonly contentType: string;
  readonly sentAt: Date;
  readonly senderShipId: ShipId;
}

/** Where a person's items show, by job and place. */
export interface Routing {
  isOn(job: ItemJob, place: RoutingPlace): boolean;
  /** Whether the place shows the item: its job on there, and for a push place sent since it was turned on. */
  isShowing(place: RoutingPlace, item: RoutedItem): boolean;
}

const keyOf = (job: ItemJob, place: RoutingPlace): string => `${job}:${place}`;

/** Whether the place only shows what the person asks it for, so it costs nothing to show what is already there (CC20). */
export function isPullPlace(place: RoutingPlace): boolean {
  switch (place) {
    case 'chat':
      return true;
    case 'slack':
    case 'web-push':
    case 'email':
      return false;
  }
}

export function routingDefaultsOf(onByDefault: readonly { readonly job: ItemJob; readonly place: RoutingPlace }[]): RoutingDefaults {
  return { onByDefault: new Set(onByDefault.map(({ job, place }) => keyOf(job, place))) };
}

export function routingOf(routes: readonly Route[], defaults: RoutingDefaults): Routing {
  const own = new Map(routes.map((route) => [keyOf(route.job, route.place), route]));
  const isOn = (job: ItemJob, place: RoutingPlace): boolean => own.get(keyOf(job, place))?.isOn ?? defaults.onByDefault.has(keyOf(job, place));
  return {
    isOn,
    isShowing: (place, { contentType, sentAt }) => {
      const job = jobOf(contentType);
      if (!isOn(job, place)) {
        return false;
      }
      // On by default, a place was never turned on later: it shows everything.
      const turnedOnAt = own.get(keyOf(job, place))?.changedAt;
      return isPullPlace(place) || turnedOnAt === undefined || sentAt.getTime() >= turnedOnAt.getTime();
    },
  };
}

/**
 * Routing with the gateway's own steps, as to sign in to a party or link
 * Slack (CC14), shown in Bridge only: never in a chat or Slack, whatever is
 * on for do there (Thomas, 1 Nov, BH8). A wake still says one waits.
 */
export function ownStepsInBridgeOnly(routing: Routing, gatewayShipId: ShipId | undefined): Routing {
  return {
    isOn: (job, place) => routing.isOn(job, place),
    isShowing: (place, item) => {
      const isOwnStep = item.senderShipId === gatewayShipId && jobOf(item.contentType) === 'do';
      return isOwnStep && (place === 'chat' || place === 'slack') ? false : routing.isShowing(place, item);
    },
  };
}
