/**
 * The gateway's web push (wake a person, W1, W4): a wake to one browser
 * through its push service, encrypted for that browser and signed with the
 * gateway's push keys (VAPID). It connects only to an address the policy
 * allows, checked as the endpoint's host resolves at the moment of sending,
 * an address written in the endpoint included: a push service is reached at
 * a public address only. The push service answers 404 or 410 once the
 * subscription ended: it is gone. Any other refusal, a refused address, or
 * no answer, failed. Subscribing lets only https through; plain http is
 * taken here for the tests' local push service.
 */
import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

// web-push is CommonJS: Node's ESM loader finds no named exports on it, only the module itself.
import webPush from 'web-push';

import type { WebPush, WebPushSent } from '../../core/people/ports.js';
import { allowedLookup } from '../webhooks/allowed-lookup.js';

/** How long a wake stays with the push service while the browser is away: a day. */
const TIME_TO_LIVE_SECONDS = 24 * 60 * 60;

const GONE_STATUSES = new Set([404, 410]);

const HTTP_OK_FIRST = 200;
const HTTP_OK_LAST = 299;

export function createWebPush(deps: {
  publicKey: string;
  privateKey: string;
  subject: string;
  timeoutMs: number;
  addressesOf: (host: string) => Promise<string[]>;
  isAllowedAddress: (address: string) => boolean;
}): WebPush {
  const lookup = allowedLookup(deps);
  return {
    send: ({ endpoint, keys: browserKeys }, wake) =>
      new Promise<WebPushSent>((resolve) => {
        let request: ReturnType<typeof webPush.generateRequestDetails>;
        let target: URL;
        try {
          request = webPush.generateRequestDetails({ endpoint, keys: browserKeys }, JSON.stringify({ fleetName: wake.fleetName, overviewUrl: wake.overviewUrl }), {
            vapidDetails: { subject: deps.subject, publicKey: deps.publicKey, privateKey: deps.privateKey },
            TTL: TIME_TO_LIVE_SECONDS,
          });
          target = new URL(request.endpoint);
        } catch {
          resolve('failed');
          return;
        }
        // Node looks up no address written in the URL itself: it is checked here instead.
        const host = target.hostname.replace(/^\[(.*)\]$/, '$1');
        if (isIP(host) !== 0 && !deps.isAllowedAddress(host)) {
          resolve('failed');
          return;
        }
        let isSettled = false;
        const settle = (sent: WebPushSent) => {
          if (!isSettled) {
            isSettled = true;
            clearTimeout(timer);
            resolve(sent);
          }
        };
        const options: RequestOptions = { method: request.method, headers: request.headers, lookup };
        const sent = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, options, (response) => {
          const status = response.statusCode ?? 0;
          settle(status >= HTTP_OK_FIRST && status <= HTTP_OK_LAST ? 'sent' : GONE_STATUSES.has(status) ? 'gone' : 'failed');
          response.resume();
        });
        const timer = setTimeout(() => {
          sent.destroy(new Error(`No answer within ${String(deps.timeoutMs)} ms`));
        }, deps.timeoutMs);
        sent.on('error', () => {
          settle('failed');
        });
        sent.end(request.body);
      }),
  };
}
