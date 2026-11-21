/** The person's record of arriving and displayed contributions, shared by every device. */
import type { MeetingId, MessageId } from '@aeolus-fleet/common';

import type { PersonShip } from '../people/ports.js';

export interface NotedContribution {
  readonly meetingId: MeetingId;
  readonly messageId: MessageId;
  readonly sentAt: Date;
}

export interface UnseenContributions {
  readonly meetingId: MeetingId;
  readonly count: number;
}

export interface MeetingContributions {
  /** Idempotent arrival or sighting. Returns whether it changed. Seen never becomes unseen; contributions before rollout stay seen without backfill. */
  note(ship: PersonShip, sighting: { readonly contributions: readonly NotedContribution[]; readonly isSeen: boolean }): Promise<boolean>;
  /** At most twenty meetings with unseen contributions, newest unseen message first. */
  unseenMeetings(ship: PersonShip): Promise<UnseenContributions[]>;
  /** Indexed counts for the requested meetings only, including zero. Never reads delivery history. */
  unseen(ship: PersonShip, meetingIds: readonly MeetingId[]): Promise<UnseenContributions[]>;
}
