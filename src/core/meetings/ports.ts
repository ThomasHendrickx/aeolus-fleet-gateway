/**
 * The meetings a person takes part in as their person ship (decision 0061,
 * M19): the fleet's meeting calls the gateway makes as the ship's crew. Core
 * holds the meeting and decides every call; the gateway reads and asks.
 */
import type { MeetingId, MessageId, ShipId, ShipKind, ShipStatus, MeetingOutput } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../connection/ports.js';
import type { Result } from '../shared/result.js';
import type { MicStanding } from './mic-standing.js';

/** A ship as a meeting names it. */
export interface MeetingShip {
  readonly shipId: ShipId;
  readonly name: string;
}

/** Whether a participant is in the meeting now, left it keeping its right to rejoin, or was revoked by the owner (M13). */
export type ParticipantState = 'present' | 'left' | 'revoked';

/** A participant: who it is, whether it is crewed now (M14), and whether it is in the meeting now. */
export interface MeetingParticipant extends MeetingShip {
  readonly kind: ShipKind;
  readonly status: ShipStatus;
  readonly state: ParticipantState;
}

/** How the mic passes when it is free (M9): by the moderator's pick, or to the oldest request. */
export type MicPattern = 'moderator' | 'fifo';

/** The mic: who holds it, none while free; its pattern; and the requests, oldest first (M8). */
export interface MeetingMic {
  readonly holder: MeetingShip | null;
  readonly pattern: MicPattern;
  readonly requests: readonly { readonly ship: MeetingShip; readonly requestedAt: Date }[];
}

/** One contribution, whole. */
export interface Contribution {
  readonly messageId: MessageId;
  readonly sender: MeetingShip;
  readonly contentType: string;
  readonly payload: string;
  readonly sentAt: Date;
}

/** A meeting as the fleet reads it to a participant, with a page of its contributions, newest first. */
export interface MeetingRead {
  readonly meetingId: MeetingId;
  readonly title: string | null;
  readonly goal: string | null;
  readonly endsAt: string | null;
  readonly endAfterCalls: number | null;
  readonly closedCalls: number;
  /** Core's complete round, with ISO times and one bounded progress page. */
  readonly call: MeetingOutput['call'];
  readonly owner: MeetingShip;
  readonly moderator: MeetingShip;
  readonly openedAt: Date;
  readonly endedAt: Date | null;
  readonly participants: readonly MeetingParticipant[];
  readonly mic: MeetingMic;
  readonly contributions: { readonly items: readonly Contribution[]; readonly nextCursor: MessageId | null };
}

/** A participant's own mic calls (M8, M10): to request it, withdraw its request, and release the mic it holds. */
export type MicChangeResult = MicStanding | { readonly kind: 'said'; readonly messageId: MessageId };

export type OwnMicChange = 'request' | 'withdraw' | 'release';

/** Contribution and crew-progress cursors advance independently within a selected round. */
export interface MeetingReadInput {
  readonly meetingId: MeetingId;
  readonly cursor?: MessageId;
  readonly callId?: MessageId;
  readonly progressCursor?: ShipId;
}

/** Outbound port: the fleet's meeting calls as the crew of a person ship. */
export interface PersonMeetingDoor {
  /** The meeting and bounded contribution and progress pages; core decides whether the person may read before joining. */
  meeting(crewToken: string, asked: MeetingReadInput): Promise<Result<MeetingRead, FleetRefusal>>;
  /** Makes one of the ship's own mic calls; the fleet refuses one the meeting does not allow now and says why. */
  changeMic(crewToken: string, asked: { meetingId: MeetingId; change: OwnMicChange; payload?: string; contentType?: string }): Promise<Result<MicChangeResult, FleetRefusal>>;
}
