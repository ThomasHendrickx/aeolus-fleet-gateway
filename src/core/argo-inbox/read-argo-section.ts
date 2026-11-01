import type { DeliveryId, FleetId, ShipId } from '@aeolus-fleet/common';

import { essenceOf, NOTICE_CONTENT_TYPE } from '../people/item-job.js';
import { staleOf, type Asking, type Stale } from '../people/stale-item.js';
import type { DoneAtArgo } from './argo-inbox.js';
import type { FollowArgoInbox } from './follow-argo-inbox.js';
import type { ArgoAccounts, ArgoMessage } from './ports.js';

/** How long a message to argo shows as new after it was sent: argo's read state is argo's alone, so the gateway cannot tell it. */
const NEW_FOR_MS = 60 * 60 * 1000;
/** How long the line saying a message was done at argo shows after it was done. */
const DONE_SHOWN_FOR_MS = 60 * 60 * 1000;

/** A message open at argo as Bridge's argo section lists it: by its title, a question or a report, in its job's look, new or not, stale once its asker withdrew or replaced it, and where to act on it. */
export interface ArgoItem {
  readonly deliveryId: DeliveryId;
  readonly title: string;
  readonly from: string;
  readonly sentAt: string;
  readonly kind: 'question' | 'report';
  readonly look: 'decide' | 'alert' | 'notice';
  readonly isNew: boolean;
  readonly stale: Stale | null;
  /** The message in the console, opened through the sign-in as argo (argo's inbox, AI2). */
  readonly consoleUrl: string;
}

/** The newest message done at argo: its title, when, by whose person ship's name if an account allowed as argo did it, and whether in the console, signed in as argo. */
export interface ArgoDone {
  readonly title: string;
  readonly at: string;
  readonly by: string | null;
  readonly isInConsole: boolean;
}

/** Bridge's argo section: what waits at argo, newest first, its own count, a stale question outside it, and the newest done at argo within the hour. */
export interface ArgoSection {
  readonly count: number;
  readonly items: readonly ArgoItem[];
  readonly done: ArgoDone | null;
}

/** None for an account not allowed as argo, or while the gateway's ship does not read argo's inbox. */
export type ReadArgoSection = (caller: { fleetId: FleetId; accountId: string }) => Promise<ArgoSection | null>;

function askingOf({ deliveryId, sender, sentAt, title, askedQuestionId, withdrawnQuestionId }: ArgoMessage): Asking {
  return { deliveryId, senderShipId: sender.shipId, sentAt, title, askedQuestionId, withdrawnQuestionId, stepId: null, withdrawnStepId: null };
}

/** A withdrawal alone asks nothing: it makes what it withdraws stale and is listed nowhere, as on Bridge home. */
function isWithdrawalOnly({ askedQuestionId, withdrawnQuestionId }: ArgoMessage): boolean {
  return withdrawnQuestionId !== null && askedQuestionId === null;
}

function lookOf({ askedQuestionId, contentType }: ArgoMessage): ArgoItem['look'] {
  if (askedQuestionId !== null) {
    return 'decide';
  }
  return essenceOf(contentType) === NOTICE_CONTENT_TYPE ? 'notice' : 'alert';
}

/**
 * Use case: an account allowed as argo reads Bridge's argo section (argo's
 * inbox, AI2 to AI4): every message open at argo as the gateway's ship
 * reads it, questions included, each sender by its own name, apart from
 * what waits on the person and with a count of its own. A question its
 * asker withdrew or replaced is stale and out of the count, as in the
 * console. Once a message is done at argo it leaves the section for every
 * account at once, and the section says who did it and where for an hour.
 */
export function createReadArgoSection(deps: {
  accounts: Pick<ArgoAccounts, 'list'>;
  inboxOf: FollowArgoInbox['inboxOf'];
  shipNames: { nameOf: (fleetId: FleetId, shipId: ShipId) => Promise<string | undefined> };
  clock: () => Date;
  consoleUrlOf: (deliveryId: DeliveryId) => string;
}): ReadArgoSection {
  const doneOf = async (fleetId: FleetId, { lastDone, now }: { lastDone: DoneAtArgo | null; now: Date }): Promise<ArgoDone | null> => {
    if (lastDone === null || now.getTime() - lastDone.at.getTime() > DONE_SHOWN_FOR_MS) {
      return null;
    }
    const { title, at, signedInAccountId } = lastDone;
    const account = signedInAccountId === null ? undefined : (await deps.accounts.list(fleetId)).find(({ accountId }) => accountId === signedInAccountId);
    const by = account === undefined ? null : ((await deps.shipNames.nameOf(fleetId, account.personShipId)) ?? null);
    return { title, at: at.toISOString(), by, isInConsole: signedInAccountId !== null };
  };

  return async ({ fleetId, accountId }) => {
    const inbox = deps.inboxOf(fleetId);
    if (inbox?.kind !== 'read') {
      return null;
    }
    const accounts = await deps.accounts.list(fleetId);
    if (!accounts.some((account) => account.accountId === accountId)) {
      return null;
    }
    const now = deps.clock();
    const asking = inbox.messages.map(askingOf);
    const items = inbox.messages
      .filter((message) => !isWithdrawalOnly(message))
      .map((message): ArgoItem => ({
        deliveryId: message.deliveryId,
        title: message.title,
        from: message.sender.name,
        sentAt: message.sentAt.toISOString(),
        kind: message.askedQuestionId === null ? 'report' : 'question',
        look: lookOf(message),
        isNew: now.getTime() - message.sentAt.getTime() < NEW_FOR_MS,
        stale: staleOf(askingOf(message), asking),
        consoleUrl: deps.consoleUrlOf(message.deliveryId),
      }))
      .reverse();
    return { count: items.filter(({ stale }) => stale === null).length, items, done: await doneOf(fleetId, { lastDone: inbox.lastDone, now }) };
  };
}
