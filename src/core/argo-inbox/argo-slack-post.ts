import type { FleetId, MessageId, ShipId } from '@aeolus-fleet/common';

/**
 * A message open at argo as it is in Slack, for a person ship of an account
 * allowed as argo (argo's inbox, AI4): posted through the gateway's own bot
 * into the person's direct messages. It is kept before Slack is asked, then
 * given its Slack message once Slack took it, so a gateway that stops in
 * between posts it at most once more; or given up once Slack refused it, so
 * it is never posted again. It is forgotten once the message is done at
 * argo and its post edited to say so.
 */
export interface ArgoSlackPost {
  readonly fleetId: FleetId;
  readonly personShipId: ShipId;
  /** The message to argo it shows. */
  readonly messageId: MessageId;
  readonly appId: string;
  readonly channel: string;
  /** The Slack message, once Slack took the post. */
  readonly ts: string | null;
  readonly isGivenUp: boolean;
}
