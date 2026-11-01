/**
 * Bridge's items as its pages show them (docs/design/bridge, section 6):
 * each job's label, and what came of an item and where, in words. Pure view
 * logic, no React and no API client.
 */
import type { inferRouterOutputs } from '@trpc/server';

import type { GatewayRouter } from '../../../../src/adapters/trpc/router.js';

/** Bridge home as the API answers it: what waits with its count, and the stay-aware feed. */
export type BridgeHome = inferRouterOutputs<GatewayRouter>['people']['home'];

/** An item on Bridge home: by its title, with its job, new or seen. */
export type HomeItem = BridgeHome['waiting']['items'][number];

/** A page of the person ship's record, as the API answers it. */
export type RecordPage = inferRouterOutputs<GatewayRouter>['people']['record'];

/** An item of the record, with its state and its outcome once kept. */
export type RecordItem = RecordPage['items'][number];

type Job = RecordItem['job'];
type Outcome = NonNullable<RecordItem['outcome']>;

const JOB_LABELS: Record<Job, string> = {
  decide: 'Decide',
  do: 'Do',
  'stay-aware': 'Stay aware',
  'everything-else': 'Message',
};

const PLACES: Record<Outcome['place'], string> = {
  bridge: 'in Bridge',
  chat: 'in a chat',
  slack: 'in Slack',
  gateway: 'by the gateway',
};

export function jobLabelOf(job: Job): string {
  return JOB_LABELS[job];
}

/** The job's word on an item's row: stay aware said as Alert or Notice (Bridge mockups, home). */
export function jobWordOf({ job, isAlert }: { job: Job; isAlert: boolean }): string {
  if (job === 'stay-aware') {
    return isAlert ? 'Alert' : 'Notice';
  }
  return JOB_LABELS[job];
}

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_YESTERDAY = 1;

/** How long ago an item arrived, as its row says it: now, minutes, hours, yesterday, then days. */
export function ageOf(sentAt: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - new Date(sentAt).getTime()) / MS_PER_MINUTE);
  if (minutes < 1) {
    return 'now';
  }
  if (minutes < MINUTES_PER_HOUR) {
    return `${String(minutes)} min`;
  }
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) {
    return `${String(hours)} h`;
  }
  const days = Math.floor(hours / HOURS_PER_DAY);
  return days === DAYS_YESTERDAY ? 'yesterday' : `${String(days)} d`;
}

/** Where the person saw an item, as its row says it: Seen in Bridge; Seen alone where the gateway did not keep where. */
export function seenTextOf(seenIn: Outcome['place'] | null): string {
  return seenIn === null ? 'Seen' : `Seen ${PLACES[seenIn]}`;
}

/** What came of an item, short, as its history says it: Answered in Slack: option 2, Cannot, in Bridge, Withdrawn by orchestrator-1. */
function saidOf(outcome: Outcome, from: string): string {
  const option = outcome.option === null ? '' : `: option ${String(outcome.option)}`;
  switch (outcome.kind) {
    case 'seen':
      return `Seen ${PLACES[outcome.place]}`;
    case 'answered':
      return `Answered ${PLACES[outcome.place]}${option}`;
    case 'done':
      return outcome.place === 'gateway' ? 'Done: the gateway saw it complete' : `Done ${PLACES[outcome.place]}`;
    case 'cannot':
      return `Cannot, ${PLACES[outcome.place]}`;
    case 'withdrawn':
      return `Withdrawn by ${from}`;
    case 'replaced':
      return `Replaced by ${from}`;
    case 'notSent':
      return `Not sent, removed ${PLACES[outcome.place]}${option}`;
  }
}

/** Whether an item ended as the person or its asker meant it to: seen, answered, done; not for cannot, withdrawn, replaced or not sent. */
function isEndedWell(kind: Outcome['kind']): boolean {
  switch (kind) {
    case 'seen':
    case 'answered':
    case 'done':
      return true;
    case 'cannot':
    case 'withdrawn':
    case 'replaced':
    case 'notSent':
      return false;
  }
}

/** The option's label after its number, when the question names it: ", Harbour first". */
function labelOf(outcome: Outcome): string {
  return outcome.optionLabel === null ? '' : `, ${outcome.optionLabel}`;
}

/**
 * What came of a done item and where, on its row in Done (done.html): the
 * answer's option with its label and the note quoted, a step's note quoted,
 * who withdrew or replaced it and with what; Done alone when the fleet ended
 * it with no outcome kept. Whether it ended well picks its icon.
 */
export function doneOutcomeOf(item: Pick<RecordItem, 'from' | 'outcome'>): { readonly text: string; readonly isOk: boolean } {
  const { outcome } = item;
  if (outcome === null) {
    return { text: 'Done', isOk: true };
  }
  const said = saidOf(outcome, item.from);
  const note = outcome.note === null ? '' : `“${outcome.note}”`;
  const text = (() => {
    switch (outcome.kind) {
      case 'answered':
        return `${said}${labelOf(outcome)}${note === '' ? '' : `${outcome.option === null ? '' : ','} with the note ${note}`}`;
      case 'notSent':
        return `${said}${labelOf(outcome)}`;
      case 'done':
      case 'cannot':
        return note === '' || outcome.place === 'gateway' ? said : `${said}: ${note}`;
      case 'replaced':
        return outcome.replacementTitle === null ? said : `Withdrawn by ${item.from}, replaced by “${outcome.replacementTitle}”`;
      case 'seen':
      case 'withdrawn':
        return said;
    }
  })();
  return { text, isOk: isEndedWell(outcome.kind) };
}

/** Whether what came of an item was sent to its asker as the person: an answer, or a step's done or cannot by the person. */
function isSentAsPerson(outcome: Outcome): boolean {
  return outcome.place !== 'gateway' && (outcome.kind === 'answered' || outcome.kind === 'done' || outcome.kind === 'cannot');
}

/**
 * What came of a done item opened from Done, where and at what time, with
 * the option's label (decide.html: "Answered in Slack at 19:58: option 2,
 * Harbour first"), and what was sent to its asker as the person, the note
 * quoted, with the places that show the same answer; none for one the
 * fleet ended with no outcome kept.
 */
/** The places besides Bridge that show an answer once given, by what each shows: Slack its post, a chat the item (CC9, view sync). */
const ANSWER_SHOWN_IN: Partial<Record<RecordItem['places'][number], string>> = {
  slack: "Slack's post",
  chat: 'the chat',
};

/** The places that show the same answer, as the opened item says it: "Slack's post and the chat show the same answer."; nothing when only Bridge showed it. */
function sameAnswerOf(places: RecordItem['places']): string {
  const shown = places.flatMap((place) => ANSWER_SHOWN_IN[place] ?? []);
  if (shown.length === 0) {
    return '';
  }
  const named = shown.length === 1 ? `${shown.join('')} shows` : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1) ?? ''} show`;
  return ` ${named.charAt(0).toUpperCase()}${named.slice(1)} the same answer.`;
}

export function endedOf(item: Pick<RecordItem, 'from' | 'outcome' | 'places'>, timeZone?: string): { readonly isOk: boolean; readonly text: string; readonly sent: string | undefined } | undefined {
  const { outcome } = item;
  if (outcome === null) {
    return undefined;
  }
  const time = ` at ${clockTimeOf(outcome.at, timeZone)}`;
  const said = saidOf({ ...outcome, option: null }, item.from);
  const option = outcome.option === null ? '' : `: option ${String(outcome.option)}${labelOf(outcome)}`;
  const text = outcome.kind === 'done' && outcome.place === 'gateway' ? `Done by the gateway${time}: it saw it complete` : `${said}${time}${option}`;
  const note = outcome.note === null ? '' : `“${outcome.note}” `;
  const sameAnswer = outcome.kind === 'answered' ? sameAnswerOf(item.places) : '';
  return { isOk: isEndedWell(outcome.kind), text, sent: isSentAsPerson(outcome) ? `${note}Sent to ${item.from} as you.${sameAnswer}` : undefined };
}

const ENDED_TITLES: Record<Outcome['kind'], string> = {
  seen: 'Seen',
  answered: 'Answered',
  done: 'Done',
  cannot: 'Cannot',
  withdrawn: 'Withdrawn',
  replaced: 'Replaced',
  notSent: 'Not sent',
};

/** The title of a done item's own screen on a phone: what came of it, such as Answered (decide.html); Done when none was kept. */
export function endedTitleOf(item: Pick<RecordItem, 'outcome'>): string {
  return item.outcome === null ? 'Done' : ENDED_TITLES[item.outcome.kind];
}

/** The places a row and a history name, as Where things show names them. */
const PLACE_NAMES: Record<RecordItem['places'][number] | 'bridge', string> = {
  bridge: 'Bridge',
  slack: 'Slack',
  chat: 'a chat',
  'web-push': 'web push',
  email: 'email',
};

/** One line of a done item's history: at what time, what happened, and what more, the last one ending it. */
export interface HistoryLine {
  readonly at: string;
  readonly text: string;
  readonly detail: string | undefined;
  readonly isEnd: boolean;
}

/**
 * A done item's history (decide.html, answered in Slack): when it arrived
 * and the places that showed it, where and when the person saw it, and
 * what came of it, done. One whose outcome is seeing it says seen once.
 */
export function historyOf(item: Pick<RecordItem, 'from' | 'sentAt' | 'places' | 'outcome'>, timeZone?: string): HistoryLine[] {
  const arrived: HistoryLine = { at: clockTimeOf(item.sentAt, timeZone), text: `Arrived from ${item.from}`, detail: `shown in ${(['bridge', ...item.places] as const).map((place) => PLACE_NAMES[place]).join(', ')}`, isEnd: false };
  const { outcome } = item;
  if (outcome === null) {
    return [arrived];
  }
  const { seen } = outcome;
  const seenLine: HistoryLine[] = seen === null || outcome.kind === 'seen' ? [] : [{ at: clockTimeOf(seen.at, timeZone), text: `Seen ${PLACES[seen.place]}`, detail: undefined, isEnd: false }];
  return [arrived, ...seenLine, { at: clockTimeOf(outcome.at, timeZone), text: saidOf(outcome, item.from), detail: 'done', isEnd: true }];
}

/** A day as a calendar date in a time zone, counted from the epoch. */
function dayNumberOf(at: Date, timeZone: string | undefined): number {
  const [year = 0, month = 1, day = 1] = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(at).split('-').map(Number);
  return Date.UTC(year, month - 1, day) / (MS_PER_MINUTE * MINUTES_PER_HOUR * HOURS_PER_DAY);
}

/** The day Done groups an item under, in the person's own time zone: Today, Yesterday, then its date (done.html). */
export function dayOf(at: string, { now, timeZone }: { now: Date; timeZone?: string }): string {
  const days = dayNumberOf(now, timeZone) - dayNumberOf(new Date(at), timeZone);
  if (days === 0) {
    return 'Today';
  }
  if (days === DAYS_YESTERDAY) {
    return 'Yesterday';
  }
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone }).format(new Date(at));
}

/**
 * The time of day an item arrived or an outcome was sent, as an opened item
 * says it (decide.html: "19:41"): the hour and minute in the person's own
 * time zone, the browser's unless one is named.
 */
export function clockTimeOf(at: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(at));
}

/** An opened item's job and whether a stay-aware one is an alert: what its heading and screen are named by. */
interface Named {
  readonly job: Job;
  readonly isAlert: boolean;
}

/** Who sent an opened item, in its heading's words: "question from orchestrator-1", "step from", or "from" alone (decide.html, do.html, stay-aware.html). */
export function fromWordsOf({ job }: Named): string {
  switch (job) {
    case 'decide':
      return 'question from';
    case 'do':
      return 'step from';
    case 'stay-aware':
    case 'everything-else':
      return 'from';
  }
}

/**
 * Whether an opened item was seen, in its heading's words: seen by this
 * opening, or already; an alert or a notice is done once seen (CC16). A
 * question or step seen before says nothing more (do.html).
 */
export function seenWordsOf({ wasNew, isDoneOnSeeing }: { wasNew: boolean; isDoneOnSeeing: boolean }): string | undefined {
  if (isDoneOnSeeing) {
    return wasNew ? 'Seen now, so done' : 'Seen, so done';
  }
  return wasNew ? 'Seen just now' : undefined;
}

/** The title of an item's own screen on a phone, beside its back chevron (decide.html, do.html). */
export function screenTitleOf(item: Named): string {
  switch (item.job) {
    case 'decide':
      return 'Question';
    case 'do':
      return 'Step';
    case 'stay-aware':
      return item.isAlert ? 'Alert' : 'Notice';
    case 'everything-else':
      return 'Message';
  }
}
