import type { MeetingId, MessageId, ShipId } from '@aeolus-fleet/common';
import type { FleetRefusal } from '../connection/ports.js';
import type { CrewPersonShip } from '../people/crew-person-ship.js';
import { asPersonCrew, withOwnRefusal, type PersonCaller, type PersonCrewError } from '../people/person-crew.js';
import type { PersonCrews } from '../people/ports.js';
import { err, ok, type Result } from '../shared/result.js';
import type { DomainError } from '../shared/errors.js';

export interface OpenCallInput { meetingId: MeetingId; question: string; idempotencyKey: string; excludedShipIds?: ShipId[]; deadline?: string }
export interface AckMeetingInput { meetingId: MeetingId; messageId: MessageId }
type MeetingCallError = PersonCrewError | (DomainError<'MEETING_REFUSED'> & FleetRefusal);
export interface MeetingCallDoor {
  openCall(token: string, input: OpenCallInput): Promise<Result<{ callId: MessageId }, FleetRefusal>>;
  ackMeetingUpTo(token: string, input: AckMeetingInput): Promise<Result<{ acknowledged: number }, FleetRefusal>>;
}
export interface MeetingCalls {
  open(input: { caller: PersonCaller; call: OpenCallInput }): Promise<Result<{ callId: MessageId }, MeetingCallError>>;
  acknowledge(input: { caller: PersonCaller; read: AckMeetingInput }): Promise<Result<{ acknowledged: number }, MeetingCallError>>;
}
export function createMeetingCalls(deps: { crewPersonShip: CrewPersonShip; crews: PersonCrews; door: MeetingCallDoor }): MeetingCalls {
  return {
    open: async ({ caller, call }) => {
      const result = await asPersonCrew(deps, { caller, run: (crew) => withOwnRefusal(deps.door.openCall(crew.crewToken, call)) });
      if (!result.isOk) return result;
      const answer = result.value.value;
      return answer.isOk ? ok(answer.value) : err({ kind: 'MEETING_REFUSED', ...answer.error });
    },
    acknowledge: async ({ caller, read }) => {
      const result = await asPersonCrew(deps, { caller, run: (crew) => withOwnRefusal(deps.door.ackMeetingUpTo(crew.crewToken, read)) });
      if (!result.isOk) return result;
      const answer = result.value.value;
      return answer.isOk ? ok(answer.value) : err({ kind: 'MEETING_REFUSED', ...answer.error });
    },
  };
}
