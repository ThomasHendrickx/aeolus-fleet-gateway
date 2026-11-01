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

const KINDS: Record<Outcome['kind'], string> = {
  seen: 'Seen',
  answered: 'Answered',
  done: 'Done',
  cannot: 'Marked cannot',
  withdrawn: 'Withdrawn by its asker, seen',
  replaced: 'Replaced by its asker, seen',
  notSent: 'Not sent, removed',
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

/** What came of an item and where, such as Answered in Slack: option 2; Done alone when no outcome was kept. */
export function outcomeTextOf(item: Pick<RecordItem, 'state' | 'outcome'>): string {
  switch (item.state) {
    case 'new':
      return 'New';
    case 'seen':
      return 'Seen, not done yet';
    case 'done': {
      const { outcome } = item;
      if (outcome === null) {
        return 'Done';
      }
      const said = `${KINDS[outcome.kind]} ${PLACES[outcome.place]}`;
      return outcome.option === null ? said : `${said}: option ${String(outcome.option)}`;
    }
  }
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
