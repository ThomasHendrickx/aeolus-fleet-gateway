/**
 * The meeting a page shows, read through the gateway's API as the signed-in
 * account (decision 0061, M12): the meeting with a page of its contributions,
 * newest first, after the cursor the address names.
 */
import type { GatewayApi } from '../../../lib/gateway-api/gateway-api';
import { readOf, type Read } from '../../../lib/gateway-api/page-api';
import type { MeetingView } from '../services/meeting';

/** The meeting page's address, before the meeting's id. */
export const MEETINGS_PATH = '/meetings';

/** The address of a meeting's page in a fleet, at the page of contributions after the cursor, if one is given. */
export function meetingPathOf(meeting: { fleetId: string; meetingId: string; cursor?: string }): string {
  const query = new URLSearchParams({ fleet: meeting.fleetId, ...(meeting.cursor === undefined ? {} : { cursor: meeting.cursor }) });
  return `${MEETINGS_PATH}/${encodeURIComponent(meeting.meetingId)}?${query.toString()}`;
}

export function readMeeting(api: GatewayApi, asked: { meetingId: string; cursor: string | undefined }): Promise<Read<MeetingView>> {
  return readOf(api.people.meeting.query({ meetingId: asked.meetingId, ...(asked.cursor === undefined ? {} : { cursor: asked.cursor }) }));
}
