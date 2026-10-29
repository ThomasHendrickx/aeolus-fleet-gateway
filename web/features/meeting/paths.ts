/** Where a meeting's page is, for server and client code alike. */

/** The meeting page's address, before the meeting's id. */
export const MEETINGS_PATH = '/meetings';

/** The address of a meeting's page in a fleet, at the page of contributions after the cursor, if one is given. */
export function meetingPathOf(meeting: { fleetId: string; meetingId: string; cursor?: string }): string {
  const query = new URLSearchParams({ fleet: meeting.fleetId, ...(meeting.cursor === undefined ? {} : { cursor: meeting.cursor }) });
  return `${MEETINGS_PATH}/${encodeURIComponent(meeting.meetingId)}?${query.toString()}`;
}
