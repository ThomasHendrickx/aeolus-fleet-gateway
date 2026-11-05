/**
 * An item's job (docs/design/bridge, section 6): a delivery to the person
 * ship is known by its content type (CC10). Decide and do wait on the person
 * and are counted in what waits; stay aware reaches them unasked, outside the
 * count; everything else is in the record only.
 */
import { ALERT_CONTENT_TYPE, MEETING_ADDED_CONTENT_TYPE, MEETING_ENDED_CONTENT_TYPE, MEETING_MIC_CONTENT_TYPE, NOTICE_CONTENT_TYPE, QUESTION_CONTENT_TYPE, REPLACEMENT_CONTENT_TYPE, STEP_CONTENT_TYPE, STEP_REPLACEMENT_CONTENT_TYPE } from '@aeolus-fleet/common';

export type ItemJob = 'decide' | 'do' | 'stay-aware' | 'everything-else';

const JOBS = new Map<string, ItemJob>([
  [QUESTION_CONTENT_TYPE, 'decide'],
  // A replacement asks its new question: it is a new item to decide (Bridge, section 9).
  [REPLACEMENT_CONTENT_TYPE, 'decide'],
  [STEP_CONTENT_TYPE, 'do'],
  // A step replacement asks its new step: a new item to do, as a question's (Bridge, CC14).
  [STEP_REPLACEMENT_CONTENT_TYPE, 'do'],
  [ALERT_CONTENT_TYPE, 'stay-aware'],
  [NOTICE_CONTENT_TYPE, 'stay-aware'],
]);

/** A content type's essence: media types compare without case and without their parameters (RFC 9110). */
export function essenceOf(contentType: string): string {
  const [essence = ''] = contentType.split(';');
  return essence.trim().toLowerCase();
}

const MEETING_NOTICES: ReadonlySet<string> = new Set([MEETING_ADDED_CONTENT_TYPE, MEETING_MIC_CONTENT_TYPE, MEETING_ENDED_CONTENT_TYPE]);

/** Whether a delivery is a meeting's added, mic or ended notice (decision 0061, M11): informational or soon out of date, so no list of what waits holds it; the record keeps it. */
export function isMeetingNotice(contentType: string): boolean {
  return MEETING_NOTICES.has(essenceOf(contentType));
}

export function jobOf(contentType: string): ItemJob {
  return JOBS.get(essenceOf(contentType)) ?? 'everything-else';
}

/** Whether an item of the job is in what waits and its count, until done. */
export function isCounted(job: ItemJob): boolean {
  switch (job) {
    case 'decide':
    case 'do':
      return true;
    case 'stay-aware':
    case 'everything-else':
      return false;
  }
}
