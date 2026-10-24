/**
 * The meeting a page shows, read through the gateway's API as the signed-in
 * account (decision 0061, M12): the meeting with a page of its contributions,
 * newest first, after the cursor the address names.
 */
import type { GatewayApi } from '../../../lib/gateway-api/gateway-api';
import { readOf, type Read } from '../../../lib/gateway-api/page-api';
import type { MeetingView } from '../services/meeting';

export function readMeeting(api: GatewayApi, asked: { meetingId: string; cursor: string | undefined }): Promise<Read<MeetingView>> {
  return readOf(api.people.meeting.query({ meetingId: asked.meetingId, ...(asked.cursor === undefined ? {} : { cursor: asked.cursor }) }));
}
