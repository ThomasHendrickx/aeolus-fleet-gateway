/**
 * The gateway's POST of a push to an outside A2A client's webhook (slice 4).
 * It connects only to an address the policy allows, checked as the name
 * resolves at the moment of connecting: the core checked the name before,
 * and this closes the gap of a name that resolves elsewhere the second time.
 * It follows no redirect. The whole POST, answer included, takes at most the
 * timeout, and the answer's body is read no further than a cap: only its
 * status counts, so a slow or endless answer never holds the party's round.
 * The core lets only https through; plain http is
 * taken here for the tests' local server.
 */
import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';

import type { PostFailure, WebhookPoster } from '../../core/a2a-in/ports.js';
import { err, ok, type Result } from '../../core/shared/result.js';

const ADDRESS_REFUSED = 'ADDRESS_REFUSED';
const IPV4 = 4;
const IPV6 = 6;
/** How much of a webhook's answer body is read before its status is taken: the fleet's payload limit. */
const ANSWER_BODY_CAP_BYTES = 64 * 1024;

/** A lookup that answers only the allowed addresses of the name, and refuses the connection otherwise. */
function allowedLookup(deps: { addressesOf: (host: string) => Promise<string[]>; isAllowedAddress: (address: string) => boolean }): LookupFunction {
  // eslint-disable-next-line @typescript-eslint/max-params -- Node's net.LookupFunction takes these three.
  return (host, options, callback) => {
    deps.addressesOf(host).then(
      (addresses) => {
        const [address] = addresses;
        if (address === undefined || !addresses.every(deps.isAllowedAddress)) {
          callback(Object.assign(new Error(`${host} resolves to an address no webhook is reached at`), { code: ADDRESS_REFUSED }), '', IPV4);
          return;
        }
        const familyOf = (each: string) => (each.includes(':') ? IPV6 : IPV4);
        // Node asks for every address when it tries them in turn (autoSelectFamily).
        if (options.all === true) {
          callback(null, addresses.map((each) => ({ address: each, family: familyOf(each) })));
        } else {
          callback(null, address, familyOf(address));
        }
      },
      (error: unknown) => {
        callback(error instanceof Error ? error : new Error(String(error)), '', IPV4);
      },
    );
  };
}

export function createWebhookPoster(deps: { addressesOf: (host: string) => Promise<string[]>; isAllowedAddress: (address: string) => boolean; timeoutMs: number }): WebhookPoster {
  const lookup = allowedLookup(deps);
  return {
    post: (url, push) =>
      new Promise<Result<{ status: number }, PostFailure>>((resolve) => {
        const target = new URL(url);
        const headers: Record<string, string> = { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(push.body)) };
        if (push.token !== null) {
          headers['x-a2a-notification-token'] = push.token;
        }
        if (push.authentication !== null) {
          headers.authorization = `${push.authentication.scheme} ${push.authentication.credentials}`;
        }
        const options: RequestOptions = { method: 'POST', headers, lookup };
        let isSettled = false;
        const settle = (result: Result<{ status: number }, PostFailure>) => {
          if (!isSettled) {
            isSettled = true;
            clearTimeout(timer);
            resolve(result);
          }
        };
        const sent = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, options, (response) => {
          const answered = () => {
            settle(ok({ status: response.statusCode ?? 0 }));
          };
          let read = 0;
          response.on('data', (chunk: Buffer) => {
            read += chunk.length;
            if (read > ANSWER_BODY_CAP_BYTES) {
              answered();
              sent.destroy();
            }
          });
          response.on('end', answered);
          // Cut short by the timeout or the cap: the request's own error, or the status taken, already settled it.
          response.on('error', (error) => {
            settle(err({ kind: 'UNREACHABLE', message: error.message }));
          });
        });
        const timer = setTimeout(() => {
          sent.destroy(new Error(`No answer within ${String(deps.timeoutMs)} ms`));
        }, deps.timeoutMs);
        sent.on('error', (error: Error & { code?: string }) => {
          settle(err(error.code === ADDRESS_REFUSED ? { kind: 'ADDRESS_REFUSED' } : { kind: 'UNREACHABLE', message: error.message }));
        });
        sent.end(push.body);
      }),
  };
}
