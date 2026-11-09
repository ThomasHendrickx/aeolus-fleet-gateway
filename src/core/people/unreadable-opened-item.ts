/** Opened questions and steps keep the schema-parsed id, never the payload. A missing id means it could not be read. */
import { QUESTION_CONTENT_TYPE, STEP_CONTENT_TYPE } from '@aeolus-fleet/common';

import { essenceOf } from './item-job.js';
import type { OpenedDelivery } from './ports.js';

export function isUnreadableOpenedItem(delivery: Pick<OpenedDelivery, 'contentType' | 'askedQuestionId' | 'stepId'>): boolean {
  const contentType = essenceOf(delivery.contentType ?? '');
  return (contentType === QUESTION_CONTENT_TYPE && delivery.askedQuestionId === null) || (contentType === STEP_CONTENT_TYPE && delivery.stepId === null);
}
