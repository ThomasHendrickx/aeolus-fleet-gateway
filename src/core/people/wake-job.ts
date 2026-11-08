/**
 * The job a web push wake names for a delivery (wake a person, W4): from its
 * content type as Bridge reads it (item-job.ts), a question or step to deal
 * with, an alert or notice to stay aware of, and every other a message.
 */
import { NOTICE_CONTENT_TYPE } from '@aeolus-fleet/common';

import { essenceOf, jobOf } from './item-job.js';

export type WakeJob = 'question' | 'step' | 'alert' | 'notice' | 'message';

export function wakeJobOf(contentType: string): WakeJob {
  const job = jobOf(contentType);
  switch (job) {
    case 'decide':
      return 'question';
    case 'do':
      return 'step';
    case 'stay-aware':
      return essenceOf(contentType) === NOTICE_CONTENT_TYPE ? 'notice' : 'alert';
    case 'everything-else':
      return 'message';
  }
}
