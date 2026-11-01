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
