'use server';
/**
 * The Overview's actions, each one call of the gateway's API as the
 * signed-in account, on the server (0033): opening, answering and being done
 * with a delivery, and deciding a request. The API checks everything; a
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
import { answerOf, questionOf, type AnswerInput, type FocusedDelivery } from '../services/deliveries';
import { EVERY_APP_SHIP_SCOPES, type DecisionInput } from '../services/requests';
import { OVERVIEW_PATH } from './read-overview';

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
      return redirect(`/sign-in/start?${new URLSearchParams({ return_to: `${OVERVIEW_PATH}?${new URLSearchParams({ [FLEET_PARAMETER]: fleet }).toString()}` }).toString()}`);
    }
    return { isOk: false, message: code === undefined ? NO_ANSWER : refusalMessageOf(error) };
  }
  revalidatePath(OVERVIEW_PATH);
  return outcome;
}

/** Opens a delivery that waits: the gateway acknowledges it for the person, and it is shown whole, once. */
export async function openDelivery(fleet: string, deliveryId: string): Promise<ActionOutcome<FocusedDelivery>> {
  return attempt(fleet, async (api) => {
    const opened = await api.people.open.mutate({ deliveryId });
    const { contentType, payload, ...entry } = opened;
    return { ...entry, payload, question: questionOf({ contentType, payload }) };
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

export async function doneDelivery(fleet: string, deliveryId: string): Promise<ActionOutcome<undefined>> {
  return attempt(fleet, async (api) => {
    await api.people.done.mutate({ deliveryId });
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
