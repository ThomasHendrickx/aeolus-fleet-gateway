/** Common's schemas decide whether a question or step can be shown to a person. */
import { QUESTION_CONTENT_TYPE, STEP_CONTENT_TYPE, questionSchema, stepSchema } from '@aeolus-fleet/common';

import { essenceOf } from './item-job.js';

/** Keep diagnostics small even when a payload produces thousands of schema issues. */
const MAX_VALIDATION_ISSUES = 10;
const MAX_VALIDATION_DETAILS_LENGTH = 4_096;

export function unreadableItem(carried: { readonly contentType: string; readonly payload: string; readonly isPayloadUnreadable?: boolean }): string | null {
  if (carried.isPayloadUnreadable === true) {
    return null;
  }
  const contentType = essenceOf(carried.contentType);
  const schema = contentType === QUESTION_CONTENT_TYPE ? questionSchema : contentType === STEP_CONTENT_TYPE ? stepSchema : null;
  if (schema === null) {
    return null;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(carried.payload);
  } catch {
    return 'Invalid JSON';
  }
  const parsed = schema.safeParse(payload);
  return parsed.success ? null : parsed.error.issues.slice(0, MAX_VALIDATION_ISSUES).map(({ path, message }) => `${path.join('.') || 'payload'}: ${message}`).join('\n').slice(0, MAX_VALIDATION_DETAILS_LENGTH);
}
