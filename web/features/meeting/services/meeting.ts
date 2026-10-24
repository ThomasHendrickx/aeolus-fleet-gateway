/**
 * A meeting as its page shows it to a participant, and what the page offers
 * them by where they stand on its mic (decision 0061, M7 to M10, M19): pure
 * view logic, no React and no API client. The fleet decides every call; the
 * page only offers what can go.
 */
import type { inferRouterOutputs } from '@trpc/server';

import type { GatewayRouter } from '../../../../src/adapters/trpc/router.js';

/** A meeting as the API reads it to the person. */
export type MeetingView = inferRouterOutputs<GatewayRouter>['people']['meeting'];

/** What the page lets the person do: contribute, or one of their own mic calls. */
export type MeetingControl = 'contribute' | 'request' | 'withdraw' | 'release';

/** The controls the page shows the person, and the line that says why. */
export function standingOf(meeting: MeetingView): { controls: MeetingControl[]; said: string } {
  if (meeting.endedAt !== null) {
    return { controls: [], said: `This meeting ended on ${new Date(meeting.endedAt).toUTCString()}.` };
  }
  const mic = meeting.yourMic;
  switch (mic.kind) {
    case 'moderating':
      return { controls: ['contribute'], said: 'You moderate: you contribute without the mic.' };
    case 'holding':
      return { controls: ['contribute', 'release'], said: 'You hold the mic: contribute, then release it once you are done.' };
    case 'requested':
      return { controls: ['withdraw'], said: `You are number ${String(mic.place)} in line for the mic.` };
    case 'none':
      return { controls: ['request'], said: 'Request the mic to contribute.' };
  }
}

/** Who holds the mic, and how it passes when it is free (M9). */
export function micLineOf(meeting: MeetingView): string {
  const holds = meeting.mic.holder === null ? 'The mic is free' : `${meeting.mic.holder.name} holds the mic`;
  const passes = meeting.mic.pattern === 'fifo' ? 'it goes to the first in line' : 'the moderator gives it';
  return `${holds}; ${passes}.`;
}

/** The text a contribution sends, trimmed; none is sent empty. */
export function contributionOf(text: string): { isOk: true; value: string } | { isOk: false; message: string } {
  const value = text.trim();
  return value === '' ? { isOk: false, message: 'Write your contribution first' } : { isOk: true, value };
}
