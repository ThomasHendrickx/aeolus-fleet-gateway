import type { MeetingId } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../../src/core/connection/ports.js';
import type { MeetingRead, OwnMicChange, PersonMeetingDoor } from '../../src/core/meetings/ports.js';
import { err, ok, type Result } from '../../src/core/shared/result.js';

import { PERSON_SHIP_ID } from './sign-in-fakes.js';

/** The weekly heads meeting Charlotte's person ship takes part in. */
export const HEADS_MEETING_ID: MeetingId = 'mtg_01m5qa5j85mgd4z61d9c2k4mtg';

export const CHIEF_OF_STAFF = { shipId: 'shp_01m5qa5j85mgd4z61d9c2kchf0', name: 'chief-of-staff' } as const;
export const HEAD_OF_MARKETING = { shipId: 'shp_01m5qa5j85mgd4z61d9c2kmkt0', name: 'head-of-marketing' } as const;
export const CHARLOTTE = { shipId: PERSON_SHIP_ID, name: 'charlotte' } as const;

/** The heads meeting as the fleet reads it: the chief of staff owns and moderates it, the mic is free, FIFO, no request, one contribution. */
export function aMeetingRead(overrides: Partial<MeetingRead> = {}): MeetingRead {
  return {
    meetingId: HEADS_MEETING_ID,
    title: 'Weekly heads',
    owner: CHIEF_OF_STAFF,
    moderator: CHIEF_OF_STAFF,
    openedAt: new Date('2026-10-24T09:00:00.000Z'),
    endedAt: null,
    participants: [
      { ...CHIEF_OF_STAFF, kind: 'plugin', status: 'crewed', state: 'present' },
      { ...HEAD_OF_MARKETING, kind: 'plugin', status: 'crewed', state: 'present' },
      { ...CHARLOTTE, kind: 'person', status: 'crewed', state: 'present' },
    ],
    mic: { holder: null, pattern: 'fifo', requests: [] },
    contributions: {
      items: [{ messageId: 'msg_01m5qa5j85mgd4z61d9c2k0001', sender: CHIEF_OF_STAFF, contentType: 'text/plain', payload: 'Round robin: marketing first', sentAt: new Date('2026-10-24T09:01:00.000Z') }],
      nextCursor: null,
    },
    ...overrides,
  };
}

/**
 * The fleet's meetings as a person ship's crew sees them in a test: the
 * meetings it takes part in, read by id; its own mic calls, recorded as
 * made; the fleet's refusals to come; and the crew token it takes.
 */
export function fakePersonMeetingDoor(ship: { crewToken: string; meetings: MeetingRead[] }) {
  const calls: string[] = [];
  const changes: { meetingId: MeetingId; change: OwnMicChange }[] = [];
  const refusals: { meeting: FleetRefusal[]; changeMic: FleetRefusal[] } = { meeting: [], changeMic: [] };
  const invalid: FleetRefusal = { code: 'UNAUTHORIZED', message: 'The crew token is not valid' };
  const crewed = <T>(crewToken: string, value: () => Result<T, FleetRefusal>): Promise<Result<T, FleetRefusal>> => Promise.resolve(crewToken === ship.crewToken ? value() : err(invalid));
  const door: PersonMeetingDoor = {
    meeting: (crewToken, { meetingId, cursor }) => {
      calls.push(`meeting(${meetingId}${cursor === undefined ? '' : `, ${cursor}`})`);
      return crewed(crewToken, () => {
        const refused = refusals.meeting.shift();
        if (refused) {
          return err(refused);
        }
        const read = ship.meetings.find((meeting) => meeting.meetingId === meetingId);
        return read ? ok(read) : err({ code: 'MEETING_NOT_FOUND', message: `Meeting ${meetingId} does not exist` });
      });
    },
    changeMic: (crewToken, asked) => {
      calls.push(`changeMic(${asked.change})`);
      return crewed(crewToken, () => {
        const refused = refusals.changeMic.shift();
        if (refused) {
          return err(refused);
        }
        changes.push(asked);
        return ok(undefined);
      });
    },
  };
  return { door, calls, changes, refusals };
}
