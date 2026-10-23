/**
 * The gateway's web push (wake a person, W1, W4): a wake to one browser
 * through its push service, encrypted for that browser and signed with the
 * gateway's push keys (VAPID). The push service answers 404 or 410 once the
 * subscription ended: it is gone. Any other refusal, or no answer, failed.
 */
// web-push is CommonJS: Node's ESM loader finds no named exports on it, only the module itself.
import webPush from 'web-push';

import type { WebPush } from '../../core/people/ports.js';

/** How long a wake stays with the push service while the browser is away: a day. */
const TIME_TO_LIVE_SECONDS = 24 * 60 * 60;

const GONE_STATUSES = new Set([404, 410]);

export function createWebPush(keys: { publicKey: string; privateKey: string; subject: string; timeoutMs: number }): WebPush {
  return {
    send: async ({ endpoint, keys: browserKeys }, wake) => {
      try {
        const request = webPush.generateRequestDetails({ endpoint, keys: browserKeys }, JSON.stringify({ fleetName: wake.fleetName, overviewUrl: wake.overviewUrl }), {
          vapidDetails: { subject: keys.subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
          TTL: TIME_TO_LIVE_SECONDS,
        });
        const response = await fetch(request.endpoint, { method: request.method, headers: request.headers, body: request.body, signal: AbortSignal.timeout(keys.timeoutMs) });
        if (response.ok) {
          return 'sent';
        }
        return GONE_STATUSES.has(response.status) ? 'gone' : 'failed';
      } catch {
        return 'failed';
      }
    },
  };
}
