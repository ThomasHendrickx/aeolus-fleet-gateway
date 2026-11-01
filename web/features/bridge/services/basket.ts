/**
 * The basket as Bridge shows it (docs/design/bridge, section 9): what each
 * entry stands as, what Send sends, and what it did, in words. Pure view
 * logic, no React and no API client.
 */
import type { inferRouterOutputs } from '@trpc/server';

import type { GatewayRouter } from '../../../../src/adapters/trpc/router.js';

type PeopleOutputs = inferRouterOutputs<GatewayRouter>['people'];

/** The basket as the API answers it: its entries in the order added, and how many answers Send sends. */
export type BasketView = PeopleOutputs['basket'];

/** An entry of the basket, with what it stands as. */
export type BasketItem = BasketView['entries'][number];

/** What Send did, as the API answers it. */
export type BasketSent = PeopleOutputs['sendBasket'];

const PLACES: Record<Extract<BasketItem['standing'], { kind: 'dealtElsewhere' }>['place'], string> = {
  bridge: 'in Bridge',
  chat: 'in a chat',
  slack: 'in Slack',
};

const SKIPPED: Record<BasketSent['skipped'][number]['kind'], string> = {
  withdrawn: 'withdrawn',
  replaced: 'replaced',
  dealtElsewhere: 'answered elsewhere',
};

function answersOf(count: number): string {
  return count === 1 ? '1 answer' : `${String(count)} answers`;
}

/** The Send button, naming how many answers it sends. */
export function sendLabelOf(toSend: number): string {
  return `Send ${answersOf(toSend)}`;
}

/** What an entry stands as, in words; nothing for one waiting for Send. */
export function standingTextOf(item: BasketItem): string | undefined {
  const { standing } = item;
  switch (standing.kind) {
    case 'waiting':
      return undefined;
    case 'sending':
      return 'Sending... The gateway keeps sending what is stored as sending, with the same key, until it is stored; you can close Bridge.';
    case 'refused':
      return `Not sent: ${standing.reason}. The others were sent.`;
    case 'withdrawn':
      return `Withdrawn by ${item.from}. Not sent; Send skips it.`;
    case 'replaced':
      return `Replaced by ${item.from}. Not sent: its options may differ, so answer the new question.`;
    case 'dealtElsewhere':
      return standing.option === null ? `Done ${PLACES[standing.place]}. Nothing is sent from it.` : `Answered ${PLACES[standing.place]}: option ${String(standing.option)}. Nothing is sent from it.`;
  }
}

/** What Send did: how many answers are being sent, and each entry it skipped and took out. */
export function sentTextOf(sent: BasketSent): string {
  const sending = sent.sending === 0 ? 'Nothing to send.' : sent.sending === 1 ? '1 answer is being sent.' : `${answersOf(sent.sending)} are being sent, each on its own, in the order you added them.`;
  if (sent.skipped.length === 0) {
    return sending;
  }
  return `${sending} Not sent: ${sent.skipped.map(({ title, kind }) => `“${title}”, ${SKIPPED[kind]}`).join('; ')}.`;
}
