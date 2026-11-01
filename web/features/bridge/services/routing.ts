/**
 * Where things show as Bridge's routing page shows it (Bridge, section 8;
 * the routing mockup): the jobs and places by the names the person reads,
 * each place card's state and its one action, and the toast that says what
 * a change does (CC20).
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

/** The jobs that wait on the person, which email's Turn on wakes them for: email says only that something waits. */
const WAITING_JOBS: readonly RoutedJob[] = ['decide', 'do'];

const KEEPS_EVERY_ITEM = 'Bridge keeps every item.';

/** What the toast after a change says: its title, and what the place now shows. */
export interface RoutingToast {
  readonly title: string;
  readonly detail: string;
}

/** What already waits of each job: the count in what waits, the unseen to stay aware of; none for everything else, which does not wait. */
export type WaitingByJob = Readonly<Record<RoutedJob, number | undefined>>;

export function waitingByJobOf({ waiting, stayAware }: { waiting: readonly { readonly job: RoutedJob }[]; stayAware: number }): WaitingByJob {
  const countOf = (job: RoutedJob) => waiting.filter((item) => item.job === job).length;
  return { decide: countOf('decide'), do: countOf('do'), 'stay-aware': stayAware, 'everything-else': undefined };
}

/** The sentence on what stays where it is: those already waiting stay in Bridge, and in a chat while one shows the job; none when nothing waits. */
function alreadyWaitingOf(waiting: number | undefined, isChatOn: boolean): string {
  if (waiting === undefined || waiting === 0) {
    return '';
  }
  const where = isChatOn ? 'in Bridge and in a chat' : 'in Bridge';
  return ` The ${String(waiting)} already waiting ${waiting === 1 ? 'stays' : 'stay'} ${where}.`;
}

/**
 * What turning a place on or off for a job does (CC20): a chat lists every
 * item not done; a place that pushes shows only what arrives from now on,
 * those already waiting staying where they are; Slack off for everything
 * else still shows a bot ship's messages (Bots only).
 */
export function turnedToastOf(change: { job: RoutedJob; place: RoutedPlace; isOn: boolean; waiting: number | undefined; isChatOn: boolean }): RoutingToast {
  const { job, place, isOn, waiting, isChatOn } = change;
  const { name, item, items } = JOB_NAMES[job];
  const title = `${PLACE_NAMES[place]} is ${isOn ? 'on' : 'off'} for ${name}`;
  if (!isOn) {
    return { title, detail: job === 'everything-else' && place === 'slack' ? `Bots only: a bot ship's messages and replies to Slack still show there. ${KEEPS_EVERY_ITEM}` : KEEPS_EVERY_ITEM };
  }
  if (place === 'chat') {
    return { title, detail: `A chat lists every ${item} not done when you ask it.` };
  }
  return { title, detail: `${PLACE_NAMES[place]} shows ${items} that arrive from now on.${alreadyWaitingOf(waiting, isChatOn)}` };
}

/** A place card's one action: none, or the one its state offers. */
export type PlaceAction = 'none' | 'link' | 'unlink' | 'remove' | 'turnOn' | 'turnOff';

/** A place card as the page draws it: its state in a badge, what it does, and its one action. */
export interface PlaceCard {
  readonly state: { readonly label: string; readonly isOk: boolean };
  readonly description: string;
  readonly action: PlaceAction;
}

const NOT_OFFERED = { label: 'Not offered', isOk: false } as const;
const OFF = { label: 'Off', isOk: false } as const;
const WAKE_SAYS = 'Says only that something waits, with a link here.';
const WAKE_OFF = `${WAKE_SAYS} Nothing is on until you turn it on.`;
const CHAT_LISTS = 'through the gateway. Lists what waits when you ask it.';

/** Slack's card: linked as the person's Slack name, not linked yet, or no workspace in the fleet. */
export function slackCardOf(slack: { workspaceName: string; link: { slackName: string } | null } | null): PlaceCard {
  if (slack === null) {
    return { state: { label: 'Not connected', isOk: false }, description: 'This fleet has no Slack workspace.', action: 'none' };
  }
  const { workspaceName, link } = slack;
  return link === null
    ? { state: { label: 'Not linked', isOk: false }, description: `Link your Slack account in ${workspaceName} to see items there and answer them.`, action: 'link' }
    : { state: { label: 'Linked', isOk: true }, description: `As @${link.slackName} in ${workspaceName}. A button press or a thread reply there is yours.`, action: 'unlink' };
}

/** A chat's card: connected, naming the chats signed in as the person, or not connected. */
export function chatCardOf(names: readonly string[]): PlaceCard {
  return names.length === 0
    ? { state: { label: 'Not connected', isOk: false }, description: `claude.ai or another MCP client, ${CHAT_LISTS}`, action: 'none' }
    : { state: { label: 'Connected', isOk: true }, description: `${new Intl.ListFormat('en', { type: 'conjunction' }).format(names)}, ${CHAT_LISTS}`, action: 'none' };
}

/** Web push's card, about this browser: on here, off here, a browser that takes none, or a gateway that sends none. */
export function webPushCardOf(webPush: {
  isOffered: boolean;
  isTaken: boolean;
  ownEndpoint: string | undefined;
  browsers: readonly { readonly endpoint: string; readonly browser: string; readonly isGone: boolean }[];
}): PlaceCard {
  if (!webPush.isOffered) {
    return { state: NOT_OFFERED, description: 'This gateway sends no web push.', action: 'none' };
  }
  if (!webPush.isTaken) {
    return { state: OFF, description: 'This browser takes no web push.', action: 'none' };
  }
  const own = webPush.browsers.find(({ endpoint, isGone }) => endpoint === webPush.ownEndpoint && !isGone);
  return own === undefined ? { state: OFF, description: WAKE_OFF, action: 'turnOn' } : { state: { label: 'This browser', isOk: true }, description: `${own.browser}. ${WAKE_SAYS}`, action: 'remove' };
}

/** Email's card: on while any job wakes by email, else off; or a gateway that sends none. */
export function emailCardOf({ isOffered, isOnForAnyJob }: { isOffered: boolean; isOnForAnyJob: boolean }): PlaceCard {
  if (!isOffered) {
    return { state: NOT_OFFERED, description: 'This gateway sends no email.', action: 'none' };
  }
  return isOnForAnyJob ? { state: { label: 'On', isOk: true }, description: WAKE_SAYS, action: 'turnOff' } : { state: OFF, description: WAKE_OFF, action: 'turnOn' };
}

/** What email's Turn on and Turn off change: on for what waits on the person where it is off; off for every job it is on for. */
export function emailTurnsOf(routing: Pick<RoutingView, 'jobs'>, isOn: boolean): { job: RoutedJob; place: 'email'; isOn: boolean }[] {
  return routing.jobs.filter(({ job, places }) => places.email !== isOn && (!isOn || WAITING_JOBS.includes(job))).map(({ job }) => ({ job, place: 'email', isOn }));
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
