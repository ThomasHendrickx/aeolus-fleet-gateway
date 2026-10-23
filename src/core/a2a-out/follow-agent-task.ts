import type { HandOutcome } from '../mcp-out/hand-call.js';
import type { Sleep } from '../mcp-out/run-party.js';
import type { A2aAgentParty } from '../parties/party.js';
import type { Clock } from '../shared/clock.js';
import type { AgentEndpoint } from './agent-endpoint.js';
import { endsFollowing, replyContentOf, type AgentEvent } from './agent-event.js';
import type { A2aAgents, AgentCall, AgentCalls, AgentKeys, AgentShipCrew, GatewayStatuses } from './ports.js';

export type FollowAgentTask = (input: { party: A2aAgentParty; endpoint: AgentEndpoint; call: AgentCall; signal: AbortSignal; events?: readonly AgentEvent[] }) => Promise<HandOutcome>;

/** The reason a delivery whose task the agent no longer knows is not handled, as Needs attention shows it. */
export const TASK_GONE = "The agent's task is gone";

const AGAIN = { kind: 'again' } as const;

/**
 * Use case: the gateway follows an outside A2A agent's task, after the agent
 * took a delivery and the gateway acknowledged it (slice 6, flow 4.2): by
 * SubscribeToTask when the card states streaming, subscribing again when a
 * stream ends early, else by GetTask every poll. Each event goes back to the
 * sender as one reply, under a key derived from the task and the event, so
 * an event seen again (a poll, a new stream, a restart) is one reply; each
 * reply is kept as telling of the task, so an answer to it continues the
 * task. At a terminal or interrupted state the delivery is handled; at the
 * deadline the gateway replies failed, then handles it; a task the agent no
 * longer knows is not handled. A reply the fleet does not take is sent again
 * after a poll. Stopped, it leaves the call followed, for the next start.
 */
export function createFollowAgentTask(deps: { crew: AgentShipCrew; agents: A2aAgents; calls: AgentCalls; keys: AgentKeys; statuses: GatewayStatuses; clock: Clock; sleep: Sleep; pollMs: number; deadlineMs: number }): FollowAgentTask {
  return async ({ party, endpoint, call, signal, events = [] }) => {
    const { crewToken } = party;
    if (crewToken === null || call.taskId === null || call.contextId === null) {
      return AGAIN;
    }
    const { taskId, contextId } = call;
    const caller = { fleetId: party.fleetId, party: party.name };
    const connection = { endpoint, credential: party.credential };
    const replied = new Set<string>();
    let endedAt: AgentEvent | undefined;
    /** Whether an event ended following: set as each event comes, so read through a call. */
    const hasEnded = () => endedAt !== undefined;

    /** Sends the event as a reply once, until the fleet takes it or the gateway stops: whether it was sent. */
    const reply = async (event: AgentEvent): Promise<boolean> => {
      const idempotencyKey = deps.keys.replyKeyOf(party.fleetId, { taskId, event: event.json });
      if (replied.has(idempotencyKey)) {
        return true;
      }
      for (;;) {
        const sent = await deps.crew.send(crewToken, { to: call.senderShipId, inReplyTo: call.messageId, ...replyContentOf(event), idempotencyKey });
        if (sent.isOk) {
          await deps.calls.saveReply(caller, { messageId: sent.value.messageId, taskId, contextId });
          replied.add(idempotencyKey);
          return true;
        }
        if (signal.aborted) {
          return false;
        }
        await deps.sleep(deps.pollMs, signal);
      }
    };
    const onEvent = async (event: AgentEvent) => {
      if ((await reply(event)) && endsFollowing(event)) {
        endedAt = event;
      }
    };
    const handled = async (): Promise<HandOutcome> => {
      if (!(await deps.crew.handled(crewToken, call.deliveryId)).isOk) {
        return AGAIN;
      }
      await deps.calls.save({ ...call, state: 'done' });
      return { kind: 'handled' };
    };
    const gone = async (reason: string): Promise<HandOutcome> => {
      await deps.calls.save({ ...call, state: 'done' });
      await deps.crew.notHandled(crewToken, { deliveryId: call.deliveryId, reason: `${TASK_GONE}: ${reason}` });
      return { kind: 'notHandled' };
    };

    for (const event of events) {
      await onEvent(event);
    }
    while (!hasEnded() && !signal.aborted) {
      const leftMs = call.deadlineAt.getTime() - deps.clock.now().getTime();
      if (leftMs <= 0) {
        const reason = `The agent did not end its task within ${String(deps.deadlineMs)} ms`;
        const failed = deps.statuses.statusOf({ taskId, contextId, state: 'failed', reason, messageId: deps.keys.replyKeyOf(party.fleetId, { taskId, event: reason }) });
        return (await reply(failed)) ? handled() : AGAIN;
      }
      if (endpoint.isStreaming) {
        const end = await deps.agents.subscribe(connection, { taskId, timeoutMs: leftMs, signal, onEvent });
        if (end.kind === 'gone') {
          return gone(end.reason);
        }
      } else {
        const read = await deps.agents.getTask(connection, taskId);
        if (read.kind === 'gone') {
          return gone(read.reason);
        }
        for (const event of read.kind === 'read' ? read.events : []) {
          await onEvent(event);
        }
      }
      if (!hasEnded()) {
        await deps.sleep(deps.pollMs, signal);
      }
    }
    return hasEnded() ? handled() : AGAIN;
  };
}
