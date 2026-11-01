/**
 * The email channel (wake a person, W2): pagasae sends the email, asked by
 * the gateway with its own installation token at `/api/wakes`, naming the
 * person ship by its fleet and id, with the key of the window, so a retry
 * mails nothing twice. The address never leaves pagasae. It reaches every
 * person; which jobs it wakes them for is routed per job (Bridge, section 8).
 */
import { z } from 'zod';

import type { WakeChannel } from '../../core/people/ports.js';
import { err, ok } from '../../core/shared/result.js';

const refusalSchema = z.object({ error: z.string() });

export function createEmailChannel(options: { url: string; installationToken: string; timeoutMs: number; windowMs: number }): WakeChannel {
  return {
    name: 'email',
    windowMs: options.windowMs,
    isOn: () => Promise.resolve(true),
    wake: async ({ fleetId, shipId }, window) => {
      let response: Response;
      try {
        response = await fetch(`${options.url}/api/wakes`, {
          method: 'POST',
          headers: { authorization: `Bearer ${options.installationToken}`, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ fleetId, shipId, key: window.key }),
          redirect: 'manual',
          signal: AbortSignal.timeout(options.timeoutMs),
        });
      } catch {
        return err({ kind: 'unavailable', reason: 'pagasae did not answer' });
      }
      if (response.ok) {
        return ok(undefined);
      }
      const refusal = refusalSchema.safeParse(await response.json().catch(() => undefined));
      // A wrong installation token (401) or an unknown person ship (404) is not fixed by asking again.
      const kind = response.status === 401 || response.status === 404 ? 'refused' : 'unavailable';
      return err({ kind, reason: `pagasae answered ${String(response.status)}${refusal.success ? `: ${refusal.data.error}` : ''}` });
    },
  };
}
