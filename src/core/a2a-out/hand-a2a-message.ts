import { MAY_HAVE_RUN, type HandOutcome, type PushedDelivery } from '../mcp-out/hand-call.js';
import type { A2aAgentParty } from '../parties/party.js';
import type { PartyStore } from '../parties/ports.js';
import type { Clock } from '../shared/clock.js';
import type { AgentEndpoint } from './agent-endpoint.js';
import { replyContentOf, type AgentEvent } from './agent-event.js';
import { outboundMessageOf } from './agent-message.js';
import type { FollowAgentTask } from './follow-agent-task.js';
import type { A2aAgents, AgentCall, AgentCalls, AgentKeys, AgentShipCrew, GatewayStatuses } from './ports.js';

export type HandA2aMessage = (input: { party: A2aAgentParty; endpoint: AgentEndpoint; delivery: PushedDelivery; signal: AbortSignal }) => Promise<HandOutcome>;

/** The channel the gateway hands an outside agent's delivery through (interop 5.1). */
const A2A_CHANNEL = 'a2a';

const AGAIN = { kind: 'again' } as const;

/**
 * Use case: the gateway hands one delivery of an outside A2A agent's proxy
 * ship to the agent (slice 6, flow 4.2): handed with the next number on
 * channel a2a, then SendMessage under a messageId derived from the
 * message, so the agent sees a message handed again as the same one. An
 * answer that takes it is acknowledged, then its task followed until it
 * ends; a message answer is replied and handled; a refusal is acknowledged,
 * replied rejected and handled. With no answer, it is handed again when the
 * agent is repeatable (A9), else reported not handled. An answer to a reply
 * the gateway sent continues that reply's task. Each step is kept before
 * the next, so a delivery that comes again picks up where it stopped.
 */
export function createHandA2aMessage(deps: {
  crew: AgentShipCrew;
  agents: A2aAgents;
  calls: AgentCalls;
  keys: AgentKeys;
  statuses: GatewayStatuses;
  parties: PartyStore;
  follow: FollowAgentTask;
  clock: Clock;
  deadlineMs: number;
}): HandA2aMessage {
  return async ({ party, endpoint, delivery, signal }) => {
    const { crewToken, fleetId } = party;
    if (crewToken === null) {
      return AGAIN;
    }
    const caller = { fleetId, party: party.name };

    /** Replies once, under a key of the delivery and what it says, then acknowledges and handles it. */
    const answered = async (call: AgentCall | undefined, event: { contentType: string; payload: string; key: string }): Promise<HandOutcome> => {
      const steps = [
        () => deps.crew.send(crewToken, { to: delivery.senderShipId, inReplyTo: delivery.messageId, contentType: event.contentType, payload: event.payload, idempotencyKey: deps.keys.replyKeyOf(fleetId, { taskId: delivery.messageId, event: event.key }) }),
        () => deps.crew.ack(crewToken, delivery.deliveryId),
        () => deps.crew.handled(crewToken, delivery.deliveryId),
      ];
      for (const step of steps) {
        if (!(await step()).isOk) {
          return AGAIN;
        }
      }
      if (call !== undefined) {
        await deps.calls.save({ ...call, state: 'done' });
      }
      return { kind: 'handled' };
    };
    const repliedEvent = (call: AgentCall, event: AgentEvent) => answered(call, { ...replyContentOf(event), key: event.json });
    const mayHaveRun = async (call: AgentCall): Promise<HandOutcome> => {
      await deps.calls.save({ ...call, state: 'mayHaveRun' });
      // A refused report leaves the call judged: it is reported again each time it comes, and never sent again.
      await deps.crew.notHandled(crewToken, { deliveryId: delivery.deliveryId, reason: MAY_HAVE_RUN });
      return { kind: 'notHandled' };
    };
    const followed = async (call: AgentCall, events: readonly AgentEvent[]): Promise<HandOutcome> => {
      if (!(await deps.crew.ack(crewToken, delivery.deliveryId)).isOk) {
        return AGAIN;
      }
      return deps.follow({ party, endpoint, call, signal, events });
    };

    const kept = await deps.calls.find(delivery.deliveryId);
    if (kept?.state === 'mayHaveRun') {
      return mayHaveRun(kept);
    }
    if (kept?.state === 'following') {
      return followed(kept, []);
    }
    if (kept?.state === 'done') {
      return (await deps.crew.handled(crewToken, delivery.deliveryId)).isOk ? { kind: 'handled' } : AGAIN;
    }
    const continued = delivery.inReplyTo === null ? undefined : await deps.calls.taskOfReply(caller, delivery.inReplyTo);
    const call: AgentCall = kept ?? {
      deliveryId: delivery.deliveryId,
      fleetId,
      party: party.name,
      messageId: delivery.messageId,
      senderShipId: delivery.senderShipId,
      state: 'sending',
      taskId: continued?.taskId ?? null,
      contextId: continued?.contextId ?? null,
      deadlineAt: new Date(deps.clock.now().getTime() + deps.deadlineMs),
    };
    const message = outboundMessageOf(delivery, { messageId: deps.keys.messageIdOf(fleetId, delivery.messageId), taskId: call.taskId, contextId: call.contextId });
    if (!message.isOk) {
      return answered(undefined, { contentType: 'text/plain', payload: message.error.message, key: message.error.message });
    }
    // The mark as it is now, not as the worker found the party: an approver may mark the agent while it runs.
    const now = await deps.parties.find(fleetId, party.name);
    const isRepeatable = now?.kind === 'a2aAgent' ? now.isRepeatable : party.isRepeatable;
    // Handed before with no answer kept and not judged unsent: the gateway stopped mid send, so it may have run.
    if (delivery.state === 'handed' && kept?.state !== 'notSent' && !isRepeatable) {
      return mayHaveRun(call);
    }

    const handed = await deps.crew.handed(crewToken, { deliveryId: delivery.deliveryId, handOverNumber: (delivery.handOverNumber ?? 0) + 1, channel: A2A_CHANNEL });
    if (!handed.isOk) {
      return AGAIN;
    }
    if (handed.value === 'undeliverable') {
      return { kind: 'undeliverable' };
    }
    const sending: AgentCall = { ...call, state: 'sending' };
    await deps.calls.save(sending);
    const outcome = await deps.agents.send({ endpoint, credential: party.credential }, message.value);
    switch (outcome.kind) {
      case 'task': {
        const following: AgentCall = { ...sending, state: 'following', taskId: outcome.taskId, contextId: outcome.contextId };
        await deps.calls.save(following);
        return followed(following, outcome.events);
      }
      case 'message':
        return repliedEvent(sending, outcome.event);
      case 'refused': {
        const rejected = deps.statuses.statusOf({ taskId: call.taskId ?? '', contextId: call.contextId ?? '', state: 'rejected', reason: outcome.reason, messageId: deps.keys.replyKeyOf(fleetId, { taskId: delivery.messageId, event: outcome.reason }) });
        return repliedEvent(sending, rejected);
      }
      case 'notSent':
        await deps.calls.save({ ...sending, state: 'notSent' });
        return AGAIN;
      case 'unanswered':
        return isRepeatable ? AGAIN : mayHaveRun(sending);
    }
  };
}
