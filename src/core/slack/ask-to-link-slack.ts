import { STEP_CONTENT_TYPE, type FleetId, type ShipId } from '@aeolus-fleet/common';

import type { ConnectionStore } from '../connection/ports.js';
import type { CallSender } from '../mcp-in/ports.js';
import type { SlackLinkSteps } from './ports.js';

/** Asks a person with no Slack link, in a fleet whose workspace is connected, to link Slack, unless they were asked since their last link. */
export type AsksToLinkSlack = (ask: { fleetId: FleetId; personShipId: ShipId; workspaceName: string }) => Promise<void>;

/** The address that starts Link Slack in a fleet. */
export type LinkSlackUrlOf = (fleetId: FleetId) => string;

/**
 * Use case: the gateway's ship asks a person, by a step to their person
 * ship (Bridge, CC14, BG7), to link Slack, with the address that starts
 * Link Slack as its link: once, and again only after a link in between
 * closes the ask. The ask's uuid is the step's and keys the message, so one
 * the fleet did not answer is sent again at the next read and stored once;
 * one it refused is not tried again. The step's message is kept with the
 * ask, so the link finishes the step.
 */
export function createAskToLinkSlack(deps: { steps: SlackLinkSteps; connections: Pick<ConnectionStore, 'find'>; sender: CallSender; newStepId: () => string; linkUrlOf: LinkSlackUrlOf }): AsksToLinkSlack {
  return async ({ fleetId, personShipId, workspaceName }) => {
    const step = await deps.steps.open(fleetId, { personShipId, stepId: deps.newStepId() });
    const gateway = await deps.connections.find(fleetId);
    if (step.isTold || gateway === undefined) {
      return;
    }
    const { stepId } = step;
    const payload = JSON.stringify({
      id: stepId,
      title: 'Link Slack',
      why: `This fleet is connected to Slack in ${workspaceName}, and your Slack account is not linked. Once linked, you talk to the fleet's bots in Slack as yourself.`,
      link: deps.linkUrlOf(fleetId),
    });
    const sent = await deps.sender.send(gateway.crewToken, { to: personShipId, contentType: STEP_CONTENT_TYPE, payload, idempotencyKey: `slack-link:${stepId}` });
    if (sent.isOk || sent.error.code !== 'UNAVAILABLE') {
      await deps.steps.markTold(fleetId, { personShipId, stepMessageId: sent.isOk ? sent.value.messageId : null });
    }
  };
}
