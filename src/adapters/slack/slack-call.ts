/**
 * One call of Slack's Web API: a form POSTed to a method, as a token if
 * given. Slack answers JSON with ok and, when not, its own error code; a 429
 * says when to ask again in Retry-After.
 */
import { z } from 'zod';

import { err, ok, type Result } from '../../core/shared/result.js';
import type { SlackRefusal } from '../../core/slack/ports.js';

/** How long the gateway waits for Slack. */
const SLACK_TIMEOUT_MS = 10_000;

/** Waited when a 429 names no Retry-After. */
const DEFAULT_RETRY_AFTER_SECONDS = 60;

const refusedSchema = z.object({ ok: z.literal(false), error: z.string() });

export type SlackCall = <T>(asked: { method: string; form: Record<string, string>; token?: string }, answers: z.ZodType<T>) => Promise<Result<T, SlackRefusal>>;

/** Calls a Web API method with a form, as the token given if any, and parses what it answers OK. */
export function createSlackCall(apiUrl: string): SlackCall {
  return async ({ method, form, token }, answers) => {
    let response: Response;
    try {
      response = await fetch(`${apiUrl}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
        body: new URLSearchParams(form),
        signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
      });
    } catch (error) {
      return err({ kind: 'unavailable', message: error instanceof Error ? error.message : String(error) });
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'));
      return err({ kind: 'rateLimited', retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : DEFAULT_RETRY_AFTER_SECONDS });
    }
    const body: unknown = await response.json().catch(() => undefined);
    const answered = answers.safeParse(body);
    if (answered.success) {
      return ok(answered.data);
    }
    const refused = refusedSchema.safeParse(body);
    return err(refused.success ? { kind: 'refused', error: refused.data.error } : { kind: 'unavailable', message: `Slack answered ${String(response.status)} with no answer the gateway reads` });
  };
}
