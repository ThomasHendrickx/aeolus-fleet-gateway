import { createHmac, timingSafeEqual } from 'node:crypto';

import type { SlackSignatures } from '../../core/slack/ports.js';

/** Slack's signature version (api.slack.com, "Verifying requests from Slack"). */
const VERSION = 'v0';

/** Slack's signature: v0= and the hex HMAC-SHA256, under the app's signing secret, of v0, the timestamp and the raw body, compared in constant time. */
export function createSlackSignatures(): SlackSignatures {
  return {
    isSigned: ({ secret, timestamp, body, signature }) => {
      const expected = Buffer.from(`${VERSION}=${createHmac('sha256', secret).update(`${VERSION}:${timestamp}:${body}`).digest('hex')}`);
      const given = Buffer.from(signature);
      return given.length === expected.length && timingSafeEqual(given, expected);
    },
  };
}
