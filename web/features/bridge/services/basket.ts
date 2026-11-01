/**
 * The basket as Bridge shows it (docs/design/bridge, section 9; basket.html,
 * basket-3 to basket-7): each entry's answer, the line under it as it
 * stands, the foot naming the ships or saying how the send goes, and what
 * was sent, in words, each with its desktop and its shorter phone words.
 * Pure view logic, no React and no API client.
 */
import type { inferRouterOutputs } from '@trpc/server';

import type { GatewayRouter } from '../../../../src/adapters/trpc/router.js';
import { clockTimeOf } from './clock-time';

type PeopleOutputs = inferRouterOutputs<GatewayRouter>['people'];

/** The basket as the API answers it: its entries in the order added, its count, and how many answers Send sends. */
export type BasketView = PeopleOutputs['basket'];

/** An entry of the basket, with what it stands as. */
export type BasketItem = BasketView['entries'][number];

type Standing = BasketItem['standing'];

/** What Send did, as the API answers it. */
export type BasketSent = PeopleOutputs['sendBasket'];

/** Words as a desktop says them, and as a phone says them, shorter. */
export interface Words {
  readonly desktop: string;
  readonly phone: string;
}

/** The line under an entry: its icon, the tone of the icon, and its words. */
export interface EntryLine {
  readonly icon: 'sent' | 'sending' | 'next' | 'unanswered' | 'refused' | 'withdrawn' | 'replaced' | 'elsewhere';
  readonly tone: 'ok' | 'waiting' | 'attention' | 'off';
  readonly words: Words;
}

/** The basket's foot: Send naming the ships, the send going on, what came of it, or none. */
export type BasketFoot = { readonly kind: 'send'; readonly words: Words; readonly label: string } | { readonly kind: 'sending'; readonly words: Words; readonly progress: string } | { readonly kind: 'summary'; readonly words: Words } | { readonly kind: 'none' };

const PLACES: Record<Extract<Standing, { kind: 'dealtElsewhere' }>['place'], string> = {
  bridge: 'in Bridge',
  chat: 'in a chat',
  slack: 'in Slack',
  gateway: 'by the gateway',
};

function same(words: string): Words {
  return { desktop: words, phone: words };
}

function answersOf(count: number): string {
  return count === 1 ? '1 answer' : `${String(count)} answers`;
}

/** Names in a sentence: a, b and c. */
function listOf(names: readonly string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

/** Each asker once, in the order added. */
function askersOf(entries: readonly BasketItem[]): string[] {
  return [...new Set(entries.map(({ from }) => from))];
}

/** The Send button, naming how many answers it sends. */
export function sendLabelOf(toSend: number): string {
  return `Send ${answersOf(toSend)}`;
}

/** The answer an entry gives, by its number and label (2. Harbour first, on today's look); a note alone as such. */
export function answerTextOf(item: Pick<BasketItem, 'option' | 'optionLabel'>): string {
  if (item.option === null) {
    return 'Note alone';
  }
  return item.optionLabel === null ? `Option ${String(item.option)}` : `${String(item.option)}. ${item.optionLabel}`;
}

/** Whether an entry is not sent, as its asker withdrew or replaced it or it was answered elsewhere first: struck out. */
export function isStruckOut(standing: Standing): boolean {
  return standing.kind === 'withdrawn' || standing.kind === 'replaced' || standing.kind === 'dealtElsewhere';
}

/** The line under one entry, given whether another entry was sent and whether this is the one being sent now. */
function lineOf(item: BasketItem, context: { isAnySent: boolean; isSendingNow: boolean }): EntryLine | undefined {
  const { standing, from } = item;
  switch (standing.kind) {
    case 'waiting':
      return undefined;
    case 'sent': {
      const at = clockTimeOf(standing.at);
      return { icon: 'sent', tone: 'ok', words: { desktop: `Sent at ${at} and stored. Done.`, phone: `Sent at ${at}. Done.` } };
    }
    case 'sending':
      if (standing.isUnanswered) {
        return { icon: 'unanswered', tone: 'waiting', words: { desktop: 'The fleet did not answer. Sending again with the same key until it is stored; it arrives once.', phone: 'No answer from the fleet. Sending again, same key.' } };
      }
      return context.isSendingNow ? { icon: 'sending', tone: 'waiting', words: same('Sending...') } : { icon: 'next', tone: 'waiting', words: { desktop: 'Next, in the order you added it', phone: 'Next' } };
    case 'refused': {
      const said = `Not sent: ${standing.reason}.`;
      // The phone says the reason without its consequence, as basket-7 draws it: Not sent: commercial was retired.
      const [cause = standing.reason] = standing.reason.split(', so ');
      return { icon: 'refused', tone: 'attention', words: { desktop: context.isAnySent ? `${said} The others were sent.` : said, phone: `Not sent: ${cause}.` } };
    }
    case 'withdrawn':
      return { icon: 'withdrawn', tone: 'off', words: { desktop: `Withdrawn by ${from} at ${clockTimeOf(standing.at)}. Not sent; Send skips it.`, phone: `Withdrawn by ${from}. Not sent.` } };
    case 'replaced': {
      const withTitle = standing.replacementTitle === null ? '.' : ` with "${standing.replacementTitle}"`;
      return { icon: 'replaced', tone: 'off', words: { desktop: `Replaced by ${from} at ${clockTimeOf(standing.at)}${withTitle} Not sent: its options differ, so answer the new one.`, phone: `Replaced by ${from}. Not sent.` } };
    }
    case 'dealtElsewhere':
      return { icon: 'elsewhere', tone: 'off', words: same(standing.option === null ? `Done ${PLACES[standing.place]}. Nothing is sent from it.` : `Answered ${PLACES[standing.place]}: option ${String(standing.option)}. Nothing is sent from it.`) };
  }
}

/** The line under each entry, in the order added: the first sending one the fleet has not left unanswered is the one being sent now, the others next. */
export function entryLinesOf(view: BasketView): (EntryLine | undefined)[] {
  const isAnySent = view.entries.some(({ standing }) => standing.kind === 'sent');
  const now = view.entries.find(({ standing }) => standing.kind === 'sending' && !standing.isUnanswered);
  return view.entries.map((item) => lineOf(item, { isAnySent, isSendingNow: item === now }));
}

/** The entries not sent, by kind, as the foot says them: The withdrawn and the replaced one are not sent. */
function notSentOf(entries: readonly BasketItem[]): string | undefined {
  const counted = (kind: Standing['kind']) => entries.filter(({ standing }) => standing.kind === kind).length;
  const stale = (['withdrawn', 'replaced'] as const).map((kind) => ({ kind, count: counted(kind) })).filter(({ count }) => count > 0);
  const named = stale.map(({ kind, count }, index) => (count > 1 ? `the ${String(count)} ${kind}` : index === stale.length - 1 ? `the ${kind} one` : `the ${kind}`));
  const elsewhere = counted('dealtElsewhere');
  const all = elsewhere === 0 ? named : [...named, elsewhere === 1 ? 'the one answered elsewhere' : `the ${String(elsewhere)} answered elsewhere`];
  if (all.length === 0) {
    return undefined;
  }
  const sentence = listOf(all);
  const isOne = stale.reduce((sum, { count }) => sum + count, elsewhere) === 1;
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)} ${isOne ? 'is' : 'are'} not sent.`;
}

/** The foot while the basket waits for Send: the ships each receiving their own answer, or how many go and which are not sent. */
function sendFootOf(view: BasketView): BasketFoot {
  const notSent = notSentOf(view.entries);
  const label = sendLabelOf(view.toSend);
  if (notSent !== undefined) {
    return { kind: 'send', words: { desktop: `${String(view.toSend)} to send. ${notSent}`, phone: notSent }, label };
  }
  const waiting = view.entries.filter(({ standing }) => standing.kind === 'waiting');
  const askers = askersOf(waiting);
  const receive = askers.length > 1 ? 'each receive their own answer' : waiting.length > 1 ? 'receives its own answer to each' : 'receives its own answer';
  return { kind: 'send', words: { desktop: `${listOf(askers)} ${receive}, as you, as if sent one by one.`, phone: 'Each asker receives its own answer.' }, label };
}

/** The basket's foot: Send while answers wait for it; Sending N of M while the send goes well; what came of it once one was not answered or refused. */
export function footOf(view: BasketView): BasketFoot {
  if (view.toSend > 0) {
    return sendFootOf(view);
  }
  const kinds = view.entries.map(({ standing }) => standing);
  const sent = kinds.filter(({ kind }) => kind === 'sent').length;
  const sending = kinds.filter(({ kind }) => kind === 'sending').length;
  const refused = kinds.filter(({ kind }) => kind === 'refused').length;
  const isAnyUnanswered = kinds.some((standing) => standing.kind === 'sending' && standing.isUnanswered);
  if (sending > 0 && refused === 0 && !isAnyUnanswered) {
    return { kind: 'sending', words: { desktop: 'You can close Bridge: the gateway keeps sending what is stored as sending.', phone: 'You can close Bridge; the gateway keeps sending.' }, progress: `Sending ${String(sent + 1)} of ${String(sent + sending)}` };
  }
  if (sending === 0 && refused === 0) {
    return { kind: 'none' };
  }
  const part = (count: number, words: string) => (count === 0 ? [] : [`${String(count)} ${words}`]);
  return {
    kind: 'summary',
    words: {
      desktop: `${[...part(sent, 'sent'), ...part(sending, 'still sending'), ...part(refused, 'not sent')].join(', ')}.`,
      phone: `${[...part(sent, 'sent'), ...part(sending, 'sending'), ...part(refused, 'not sent')].join(', ')}.`,
    },
  };
}

/** What was sent, once every entry left in the basket was sent: how many answers, to which ships. */
export function sentSummaryOf(view: BasketView): { title: string; description: string } | undefined {
  const { entries } = view;
  if (entries.length === 0 || entries.some(({ standing }) => standing.kind !== 'sent')) {
    return undefined;
  }
  const to = `To ${listOf(askersOf(entries))}, as you;`;
  return { title: `${answersOf(entries.length)} sent`, description: entries.length === 1 ? `${to} stored, and in Done.` : `${to} each stored, each in Done.` };
}
