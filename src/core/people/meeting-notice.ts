import { MEETING_ADDED_CONTENT_TYPE, meetingAddedSchema } from '@aeolus-fleet/common';

/** The words a person sees for the meeting-added notice that carries a meeting's full record. */
export function meetingNoticeTextOf(delivery: { readonly from: string; readonly contentType: string; readonly payload: string }): string | undefined {
  if (delivery.contentType !== MEETING_ADDED_CONTENT_TYPE) {
    return undefined;
  }
  try {
    const added = meetingAddedSchema.safeParse(JSON.parse(delivery.payload));
    if (!added.success) {
      return undefined;
    }
    return added.data.title === null ? `${delivery.from} added you to a meeting.` : `${delivery.from} added you to the meeting “${added.data.title}”.`;
  } catch {
    return undefined;
  }
}
