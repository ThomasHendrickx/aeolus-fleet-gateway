import type { Clock } from '../shared/clock.js';
import type { SlackSignatures } from './ports.js';
import type { SlackApp } from './slack-app.js';

/** How far a request's timestamp may be from now (gateway scopes 9.4 step 1). */
export const EVENT_SKEW_MS = 5 * 60 * 1000;

const SECOND_MS = 1000;

/** A request Slack sends for one of the gateway's apps: its raw body as signed, its timestamp and its signature. */
export interface SignedRequest {
  readonly body: string;
  readonly timestamp: string;
  readonly signature: string;
}

/** Whether Slack signed the request with the app's signing secret, its timestamp within 5 minutes of now: an event, or a press of a button. */
export function isSignedBy(app: SlackApp | undefined, signed: { request: SignedRequest; signatures: SlackSignatures; clock: Clock }): app is SlackApp {
  const { request } = signed;
  const sentAt = Number(request.timestamp) * SECOND_MS;
  return app !== undefined && Number.isFinite(sentAt) && Math.abs(signed.clock.now().getTime() - sentAt) <= EVENT_SKEW_MS && signed.signatures.isSigned({ secret: app.signingSecret, ...request });
}
