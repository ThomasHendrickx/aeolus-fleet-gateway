import { STEP_CONTENT_TYPE, STEP_REPLACEMENT_CONTENT_TYPE, stepSchema, stepReplacementSchema } from '@aeolus-fleet/common';

import { askedQuestionOf } from './inbox-entry.js';
import { essenceOf } from './item-job.js';
import type { PersonDelivery } from './ports.js';

/** The asker's own context or why, with no copy kept and no text rewritten. */
export function itemReasonOf(delivery: Pick<PersonDelivery, 'contentType' | 'payload'>): { readonly reason?: string } {
  const question = askedQuestionOf(delivery);
  if (question !== null) {
    return question.context === '' ? {} : { reason: question.context };
  }
  const essence = essenceOf(delivery.contentType);
  if (essence !== STEP_CONTENT_TYPE && essence !== STEP_REPLACEMENT_CONTENT_TYPE) {
    return {};
  }
  let payload: unknown;
  try {
    payload = JSON.parse(delivery.payload);
  } catch {
    return {};
  }
  const step = essence === STEP_CONTENT_TYPE ? stepSchema.safeParse(payload).data : stepReplacementSchema.safeParse(payload).data?.step;
  return step === undefined || step.why === '' ? {} : { reason: step.why };
}
