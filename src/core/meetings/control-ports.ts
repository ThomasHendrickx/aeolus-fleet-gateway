/** Calls core offers a person for running and finding their meetings (0061). */
import type { MeetingId, ShipId, MeetingsOutput, MicPattern } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../connection/ports.js';
import type { Result } from '../shared/result.js';

export type MeetingCommand =
  | { readonly call: 'openMeeting'; readonly input: { readonly ships?: readonly { readonly name: string }[]; readonly title?: string; readonly idempotencyKey: string } }
  | { readonly call: 'addToMeeting'; readonly input: { readonly meetingId: MeetingId; readonly ships?: readonly { readonly name: string }[] } }
  | { readonly call: 'leaveMeeting' | 'rejoinMeeting' | 'takeMic' | 'endMeeting'; readonly input: { readonly meetingId: MeetingId } }
  | { readonly call: 'revokeFromMeeting' | 'transferMeeting' | 'nameModerator' | 'giveMic'; readonly input: { readonly meetingId: MeetingId; readonly shipId: ShipId } }
  | { readonly call: 'setMicPattern'; readonly input: { readonly meetingId: MeetingId; readonly pattern: MicPattern } };

export interface MeetingPageInput {
  readonly cursor?: string;
  readonly limit: number;
}

export interface MeetingControls {
  list(crewToken: string, input: MeetingPageInput): Promise<Result<MeetingsOutput, FleetRefusal>>;
  change(crewToken: string, command: MeetingCommand): Promise<Result<{ meetingId?: MeetingId }, FleetRefusal>>;
}
