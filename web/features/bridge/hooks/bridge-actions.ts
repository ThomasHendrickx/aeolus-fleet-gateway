'use server';
/**
 * Bridge's actions, each one call of the gateway's API as the signed-in
 * account, on the server (0033): opening, answering and being done with an
 * item, putting an answer in the basket, removing it and sending the basket,
 * reading the next page of the record, and in Bridge's settings the
 * wake channels, the Slack link and deciding a request. The API checks everything; a
 * refusal comes back in its own words for the page to say by the control. A
 * sign-in that ended sends the person to sign in again.
 */
import { idSchema } from '@aeolus-fleet/common';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { GatewayApi } from '../../../lib/gateway-api/gateway-api';
import { FLEET_PARAMETER } from '../../../lib/gateway-api/page-account';
import { refusalCodeOf, refusalMessageOf, requestApi } from '../../../lib/gateway-api/page-api';
import { serverCredentialOf } from '../../forms/server-credential';
import { answerOf, bodyOf, questionOf, stepOf, type AnswerInput, type FocusedDelivery } from '../services/deliveries';
import type { SubscriptionInput } from '../services/web-push';
import { EVERY_APP_SHIP_SCOPES, type DecisionInput } from '../services/requests';
import type { BasketSent } from '../services/basket';
import type { RecordPage } from '../services/items';
import { BRIDGE_PATH } from '../paths';

/** What an action says when the gateway gave no answer of its own. */
const NO_ANSWER = 'The gateway did not answer: try again in a moment';

export type ActionOutcome<T> = { readonly isOk: true; readonly value: T } | { readonly isOk: false; readonly message: string };

async function attempt<T>(fleet: string, run: (api: GatewayApi) => Promise<T>): Promise<ActionOutcome<T>> {
  let outcome: ActionOutcome<T>;
  try {
    outcome = { isOk: true, value: await run(await requestApi(fleet)) };
  } catch (error) {
    const code = refusalCodeOf(error);
    if (code === 'UNAUTHORIZED') {
      return redirect(`/sign-in/start?${new URLSearchParams({ return_to: `${BRIDGE_PATH}?${new URLSearchParams({ [FLEET_PARAMETER]: fleet }).toString()}` }).toString()}`);
    }
    return { isOk: false, message: code === undefined ? NO_ANSWER : refusalMessageOf(error) };
  }
  revalidatePath(BRIDGE_PATH, 'layout');
  return outcome;
}

/** The next page of the person ship's record, after the cursor the last one answered (Done). */
export async function readMoreRecord(fleet: string, cursor: string): Promise<ActionOutcome<RecordPage>> {
  return attempt(fleet, (api) => api.people.record.query({ cursor }));
}

/** Opens an item: the gateway acknowledges it for the person, and it is shown whole, once; an alert or a notice seen is done (CC16). */
export async function openDelivery(fleet: string, deliveryId: string): Promise<ActionOutcome<FocusedDelivery>> {
  return attempt(fleet, async (api) => {
    const opened = await api.people.open.mutate({ deliveryId });
    const { contentType, payload, meetingId, ...entry } = opened;
    return { ...entry, payload, body: bodyOf({ contentType, payload }), question: questionOf({ contentType, payload }), step: stepOf({ contentType, payload }), meetingId: meetingId ?? undefined };
  });
}

export async function answerDelivery({ fleet, deliveryId, input }: { fleet: string; deliveryId: string; input: AnswerInput }): Promise<ActionOutcome<undefined>> {
  const answer = answerOf(input);
  if (!answer.isOk) {
    return answer;
  }
  return attempt(fleet, async (api) => {
    await api.people.answer.mutate({ deliveryId, ...answer.value });
    return undefined;
  });
}

/** Puts the person's answer to a question in the basket, or changes it there: nothing is sent (Bridge, section 9). */
export async function putInBasket({ fleet, deliveryId, option, note }: { fleet: string; deliveryId: string; option: number; note: string }): Promise<ActionOutcome<undefined>> {
  return attempt(fleet, async (api) => {
    await api.people.putInBasket.mutate({ deliveryId, option, note });
    return undefined;
  });
}

/** Takes an answer out of the basket; one the fleet refused marks its question done, not sent. */
export async function removeFromBasket(fleet: string, questionId: string): Promise<ActionOutcome<undefined>> {
  return attempt(fleet, async (api) => {
    await api.people.removeFromBasket.mutate({ questionId });
    return undefined;
  });
}

/** Send N answers: each entry stored as sending, then sent on its own by the gateway. */
export async function sendBasket(fleet: string): Promise<ActionOutcome<BasketSent>> {
  return attempt(fleet, (api) => api.people.sendBasket.mutate());
}

/** Is done with an item; a step done or cannot, with the person's note if they wrote one, its outcome sent at once (CC14, CC23). */
export async function doneDelivery({ fleet, deliveryId, step }: { fleet: string; deliveryId: string; step?: { outcome: 'done' | 'cannot'; note: string } }): Promise<ActionOutcome<undefined>> {
  return attempt(fleet, async (api) => {
    await api.people.done.mutate(step === undefined ? { deliveryId } : { deliveryId, ...step });
    return undefined;
  });
}

/** Turns email on or off, to be woken when something waits for the person's own ship (wake a person, W8). */
export async function turnEmail(fleet: string, isOn: boolean): Promise<ActionOutcome<undefined>> {
  return attempt(fleet, async (api) => {
    await api.people.turnEmail.mutate({ isOn });
    return undefined;
  });
}

/** Turns web push on for the browser that subscribed (wake a person, W8). */
export async function turnOnWebPush(fleet: string, subscription: SubscriptionInput): Promise<ActionOutcome<undefined>> {
  return attempt(fleet, async (api) => {
    await api.people.turnOnWebPush.mutate({ endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth }, browser: subscription.browser });
    return undefined;
  });
}

/** Removes a browser the person turned web push on in. */
export async function turnOffWebPush(fleet: string, endpoint: string): Promise<ActionOutcome<undefined>> {
  return attempt(fleet, async (api) => {
    await api.people.turnOffWebPush.mutate({ endpoint });
    return undefined;
  });
}

/** Unlinks the person's Slack account (gateway scopes 9.3). */
export async function unlinkSlack(fleet: string): Promise<ActionOutcome<undefined>> {
  return attempt(fleet, async (api) => {
    await api.slack.unlink.mutate();
    return undefined;
  });
}

/** Turns Show everything that waits in Slack on or off (gateway scopes 9.6, B5). */
export async function showAllInSlack(fleet: string, isOn: boolean): Promise<ActionOutcome<undefined>> {
  return attempt(fleet, async (api) => {
    await api.slack.showAll.mutate({ isOn });
    return undefined;
  });
}

/** Decides a request; approving names the proxy ship, its owner and its scopes, messages:send and messages:receive always among them. */
export async function decideRequest({ fleet, requestId, input }: { fleet: string; requestId: string; input: DecisionInput }): Promise<ActionOutcome<undefined>> {
  if (input.kind === 'deny') {
    return attempt(fleet, async (api) => {
      await api.requests.decide.mutate({ requestId, decision: { kind: 'deny' } });
      return undefined;
    });
  }
  const ownerShipId = idSchema('ship').safeParse(input.ownerShipId.trim());
  if (!ownerShipId.success) {
    return { isOk: false, message: "The owner's ship id is not a ship id (shp_...)" };
  }
  const party = { name: input.name, ownerShipId: ownerShipId.data, scopes: [...new Set([...EVERY_APP_SHIP_SCOPES, ...input.scopes])] };
  const { server } = input;
  const credential = server === undefined ? undefined : serverCredentialOf(server);
  return attempt(fleet, async (api) => {
    await api.requests.decide.mutate({ requestId, decision: { kind: 'approve', party, ...(server === undefined || credential === undefined ? {} : { server: { credential, concurrencyLimit: server.concurrencyLimit } }) } });
    return undefined;
  });
}
