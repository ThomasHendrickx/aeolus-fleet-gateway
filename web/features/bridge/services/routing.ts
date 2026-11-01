/**
 * Routing per job as Bridge's routing page shows it (Bridge, section 8):
 * the jobs and places by the names the person reads, and what a change
 * says it does (CC20).
 */
import type { inferRouterOutputs } from '@trpc/server';

import type { GatewayRouter } from '../../../../src/adapters/trpc/router.js';

/** Where each job shows besides Bridge, per place, as the API answers it. */
export type RoutingView = inferRouterOutputs<GatewayRouter>['people']['routing'];
export type RoutedJob = RoutingView['jobs'][number]['job'];
export type RoutedPlace = keyof RoutingView['offered'];

export const ROUTED_PLACES: readonly RoutedPlace[] = ['slack', 'chat', 'web-push', 'email'];

export const JOB_NAMES: Readonly<Record<RoutedJob, { readonly name: string; readonly holds: string; readonly item: string; readonly items: string }>> = {
  decide: { name: 'Decide', holds: 'Questions from your ships', item: 'question', items: 'questions' },
  do: { name: 'Do what only you can', holds: 'Steps: sign in, create, approve', item: 'step', items: 'steps' },
  'stay-aware': { name: 'Stay aware', holds: 'Alerts and notices', item: 'alert or notice', items: 'alerts and notices' },
  'everything-else': { name: 'Everything else', holds: 'Replies and other messages', item: 'message', items: 'messages' },
};

export const PLACE_NAMES: Readonly<Record<RoutedPlace, string>> = { slack: 'Slack', chat: 'A chat', 'web-push': 'Web push', email: 'Email' };

const KEEPS_EVERY_ITEM = 'Bridge keeps every item.';

/** What turning a place on or off for a job does: a chat lists what is not done, a place that pushes only what arrives after. */
export function turnedMessageOf({ job, place, isOn }: { job: RoutedJob; place: RoutedPlace; isOn: boolean }): string {
  const { name, item, items } = JOB_NAMES[job];
  const turned = `${PLACE_NAMES[place]} is ${isOn ? 'on' : 'off'} for ${name}`;
  if (!isOn) {
    return job === 'everything-else' && place === 'slack' ? `${turned}: only a bot ship's messages and replies to Slack show there. ${KEEPS_EVERY_ITEM}` : `${turned}. ${KEEPS_EVERY_ITEM}`;
  }
  if (place === 'chat') {
    return `${turned}: it lists every ${item} not done when you ask it.`;
  }
  return `${turned}: it shows ${items} that arrive from now on. Those already waiting stay in Bridge.`;
}

/** The places as a sentence names them after Bridge. */
const PLACE_WORDS: Readonly<Record<RoutedPlace, string>> = { slack: 'Slack', chat: 'a chat', 'web-push': 'web push', email: 'email' };

/** The places besides Bridge that show a question: those routing has on for Decide that the gateway offers, in routing's order. */
export function decidePlacesOf(routing: RoutingView): RoutedPlace[] {
  const decide = routing.jobs.find(({ job }) => job === 'decide');
  return ROUTED_PLACES.filter((place) => routing.offered[place] && decide?.places[place] === true);
}

/** Where an opened question shows (decide.html): Bridge and the places on for Decide, and that one answer counts wherever it is given. */
export function shownInOf(places: readonly RoutedPlace[]): string {
  const named = ['Bridge', ...places.map((place) => PLACE_WORDS[place])];
  const last = named.at(-1);
  const list = named.length === 1 ? 'Bridge' : `${named.slice(0, -1).join(', ')} and ${String(last)}`;
  return `Shows in ${list}, as Where things show sets for Decide. One answer, wherever you give it.`;
}
