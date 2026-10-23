/**
 * Use case: the pushes due now are POSTed to their webhooks (slice 4). Each
 * config's pushes go in the order kept: a later one waits while an earlier
 * one is tried again. A 2xx delivers it. A 408, a 429, a 5xx or no answer
 * tries it again after the gateway's waits, each longer than the last, and
 * gives it up after the last. Any other answer gives it up at once, as does
 * a host that resolves to an inside address now, or an inside address the
 * POST was about to connect to. A push given up leaves the task as it was:
 * GetTask still answers it.
 */
import type { Clock } from '../shared/clock.js';
import type { A2aCaller } from './authenticate-a2a-client.js';
import type { HostResolver, Push, Pushes, WebhookPoster } from './ports.js';
import { isReachedOnlyInPublic } from './webhook-address.js';

export type DeliverPushes = (caller: A2aCaller) => Promise<void>;

/** The most pushes POSTed in one round, for one party. */
const ROUND_MAX = 20;
const HTTP_REQUEST_TIMEOUT = 408;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SUCCESS = { from: 200, to: 299 };
const HTTP_SERVER_ERROR = 500;

/** Whether an answer of this status is worth another attempt. */
const isWorthAgain = (status: number) => status === HTTP_REQUEST_TIMEOUT || status === HTTP_TOO_MANY_REQUESTS || status >= HTTP_SERVER_ERROR;

interface DeliverPushesDeps {
  pushes: Pushes;
  resolver: HostResolver;
  poster: WebhookPoster;
  clock: Clock;
  /** The wait before each attempt again; after the last, the push is given up. */
  againWaitsMs: readonly number[];
}

export function createDeliverPushes(deps: DeliverPushesDeps): DeliverPushes {
  /** What came of one attempt: delivered, worth another, or given up with why. */
  const attempt = async (push: Push): Promise<{ outcome: 'delivered' | 'again' } | { outcome: 'givenUp'; reason: string }> => {
    if (!(await isReachedOnlyInPublic(deps.resolver, new URL(push.config.url)))) {
      return { outcome: 'givenUp', reason: 'The webhook resolves to an inside address' };
    }
    const posted = await deps.poster.post(push.config.url, { body: push.body, token: push.config.token, authentication: push.config.authentication });
    if (!posted.isOk) {
      return posted.error.kind === 'ADDRESS_REFUSED' ? { outcome: 'givenUp', reason: 'The webhook connected to an inside address' } : { outcome: 'again' };
    }
    const { status } = posted.value;
    if (status >= HTTP_SUCCESS.from && status <= HTTP_SUCCESS.to) {
      return { outcome: 'delivered' };
    }
    return isWorthAgain(status) ? { outcome: 'again' } : { outcome: 'givenUp', reason: `The webhook answered ${String(status)}` };
  };

  return async (caller) => {
    for (const push of await deps.pushes.due(caller, { now: deps.clock.now(), limit: ROUND_MAX })) {
      const came = await attempt(push);
      const attempts = push.attempts + 1;
      const at = deps.clock.now();
      const wait = deps.againWaitsMs[attempts - 1];
      if (came.outcome === 'delivered') {
        await deps.pushes.delivered(caller, { pushId: push.pushId, attempts, at });
      } else if (came.outcome === 'again' && wait !== undefined) {
        await deps.pushes.again(caller, { pushId: push.pushId, attempts, at: new Date(at.getTime() + wait) });
      } else {
        await deps.pushes.givenUp(caller, { pushId: push.pushId, attempts, reason: came.outcome === 'givenUp' ? came.reason : `No answer after ${String(attempts)} attempts`, at });
      }
    }
  };
}
