'use server';
/**
 * The meeting page's actions, each one call of the gateway's API as the
 * signed-in account, on the server (0033): contributing, and the person's
 * own mic calls. The fleet decides each; a refusal comes back in its own
 * words for the page to say by the control. A sign-in that ended sends the
 * person to sign in again, back to the meeting.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { refusalCodeOf, refusalMessageOf, requestApi } from '../../../lib/gateway-api/page-api';
import type { ActionOutcome } from '../../overview/hooks/overview-actions';
import { contributionOf } from '../services/meeting';
import { MEETINGS_PATH, meetingPathOf } from './read-meeting';

/** What an action says when the gateway gave no answer of its own. */
const NO_ANSWER = 'The gateway did not answer: try again in a moment';

/** A person's own mic call on the page. */
export type OwnMicChange = 'request' | 'withdraw' | 'release';

async function attempt(meeting: { fleet: string; meetingId: string }, run: (api: Awaited<ReturnType<typeof requestApi>>) => Promise<unknown>): Promise<ActionOutcome<undefined>> {
  try {
    await run(await requestApi(meeting.fleet));
  } catch (error) {
    const code = refusalCodeOf(error);
    if (code === 'UNAUTHORIZED') {
      return redirect(`/sign-in/start?${new URLSearchParams({ return_to: meetingPathOf({ fleetId: meeting.fleet, meetingId: meeting.meetingId }) }).toString()}`);
    }
    return { isOk: false, message: code === undefined ? NO_ANSWER : refusalMessageOf(error) };
  }
  revalidatePath(`${MEETINGS_PATH}/${meeting.meetingId}`);
  return { isOk: true, value: undefined };
}

/** Contributes the person's text to the meeting, once under the key the page holds for this draft. */
export async function contribute(input: { fleet: string; meetingId: string; text: string; idempotencyKey: string }): Promise<ActionOutcome<undefined>> {
  const contribution = contributionOf(input.text);
  if (!contribution.isOk) {
    return contribution;
  }
  return attempt(input, (api) => api.people.contribute.mutate({ meetingId: input.meetingId, payload: contribution.value, idempotencyKey: input.idempotencyKey }));
}

export async function changeMic(input: { fleet: string; meetingId: string; change: OwnMicChange }): Promise<ActionOutcome<undefined>> {
  return attempt(input, (api) => api.people.mic.mutate({ meetingId: input.meetingId, change: input.change }));
}
