import type { ShipId } from '@aeolus-fleet/common';

import type { MeetingRead } from './ports.js';

/**
 * Where a participant stands on a meeting's mic (M7, M8): it moderates, so it
 * contributes without the mic; it holds the mic; it waits in line, at its
 * place counted from 1; or none of these, so it requests the mic first.
 */
export type MicStanding = { readonly kind: 'moderating' } | { readonly kind: 'holding' } | { readonly kind: 'requested'; readonly place: number } | { readonly kind: 'none' };

export function micStandingOf(meeting: MeetingRead, shipId: ShipId): MicStanding {
  if (meeting.moderator.shipId === shipId) {
    return { kind: 'moderating' };
  }
  if (meeting.mic.holder?.shipId === shipId) {
    return { kind: 'holding' };
  }
  const index = meeting.mic.requests.findIndex(({ ship }) => ship.shipId === shipId);
  return index < 0 ? { kind: 'none' } : { kind: 'requested', place: index + 1 };
}
