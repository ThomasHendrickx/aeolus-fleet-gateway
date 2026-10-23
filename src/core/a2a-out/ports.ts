/**
 * The ports of A2A out: how the gateway reads an outside A2A agent's card,
 * as the proto's AgentCard states it, keeping only what it uses (slice 5);
 * and how it hands the agent a message and follows its task, keeping each
 * call so a restart follows on and sends nothing twice (slice 6).
 */
import type { DeliveryId, FleetId, MessageId, ShipId } from '@aeolus-fleet/common';

import type { CallSender } from '../mcp-in/ports.js';
import type { ProxyShipCrew } from '../mcp-out/hand-call.js';
import type { Result } from '../shared/result.js';
import type { McpServerCredential } from '../vault/credential.js';
import type { AgentEndpoint } from './agent-endpoint.js';
import type { AgentEvent, ChunkPlaces } from './agent-event.js';
import type { OutboundMessage } from './agent-message.js';

/** An address the agent answers at, in one binding and one version of A2A. */
export interface AgentInterface {
  readonly url: string;
  readonly protocolBinding: string;
  readonly protocolVersion: string;
}

/** One thing the agent can do (A2A's AgentSkill): its media types, when it names its own. */
export interface AgentSkill {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly inputModes: readonly string[];
  readonly outputModes: readonly string[];
}

/** An outside A2A agent's public card. */
export interface AgentCard {
  readonly name: string;
  readonly description: string;
  readonly supportedInterfaces: readonly AgentInterface[];
  readonly defaultInputModes: readonly string[];
  readonly defaultOutputModes: readonly string[];
  /** Whether the card states streaming, so the gateway follows a task by SubscribeToTask. */
  readonly isStreaming: boolean;
  readonly skills: readonly AgentSkill[];
}

/** Why a card could not be read: nothing answered with one, or what answered is no AgentCard. */
export type CardFailure = { kind: 'UNREACHABLE'; reason: string } | { kind: 'NOT_A_CARD'; reason: string };

export interface AgentCards {
  /** The card at its address, read with no credential, as a public card is. */
  read(cardUrl: string): Promise<Result<AgentCard, CardFailure>>;
}

/** Where and how the gateway calls an agent: its endpoint, and the credential from the vault. */
export interface AgentConnection {
  readonly endpoint: AgentEndpoint;
  readonly credential: McpServerCredential;
}

/**
 * How SendMessage ended (6):
 * - task: the agent took it as a task, with what it tells of it so far;
 * - message: the agent answered with a message and no task;
 * - refused: an A2A error or an HTTP 4xx, so it did not run;
 * - notSent: the gateway never reached the agent (its credential could not be had), so it did not run;
 * - unanswered: a 5xx, a timeout or a broken connection: whether it ran is unknown.
 */
export type SendOutcome =
  | { readonly kind: 'task'; readonly taskId: string; readonly contextId: string; readonly events: readonly AgentEvent[] }
  | { readonly kind: 'message'; readonly event: AgentEvent }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'notSent'; readonly reason: string }
  | { readonly kind: 'unanswered'; readonly reason: string };

/** GetTask: the task as it stands, its status and each artifact; gone when the agent knows it no more; refused (an A2A error or an HTTP 4xx); or no answer. */
export type TaskRead =
  | { readonly kind: 'read'; readonly events: readonly AgentEvent[] }
  | { readonly kind: 'gone'; readonly reason: string }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'unanswered'; readonly reason: string };

/** How a SubscribeToTask stream ended: the agent closed it, the task is gone, the agent refused it (as it does for a task that ended), or it broke. */
export type SubscriptionEnd = { readonly kind: 'closed' } | { readonly kind: 'gone'; readonly reason: string } | { readonly kind: 'refused'; readonly reason: string } | { readonly kind: 'broken'; readonly reason: string };

/** Outbound port: the outside A2A agents the gateway calls, through @a2a-js/sdk's client (A11). */
export interface A2aAgents {
  /** SendMessage, returning at once (return_immediately). */
  send(connection: AgentConnection, message: OutboundMessage): Promise<SendOutcome>;
  getTask(connection: AgentConnection, taskId: string): Promise<TaskRead>;
  /** SubscribeToTask: each event the stream sends, in turn, until it ends, the timeout passes (broken) or the signal aborts. */
  subscribe(connection: AgentConnection, follow: { taskId: string; timeoutMs: number; signal: AbortSignal; onEvent: (event: AgentEvent) => Promise<void> }): Promise<SubscriptionEnd>;
}

/** Outbound port: the A2A statuses the gateway itself tells of a task: failed at its deadline, rejected when the agent refused the message. */
export interface GatewayStatuses {
  statusOf(status: { taskId: string; contextId: string; state: 'failed' | 'rejected'; reason: string; messageId: string }): AgentEvent;
}

/** Outbound port: the ids the gateway derives, so the same message and event always get the same ones. */
export interface AgentKeys {
  /** The A2A messageId the agent gets for a fleet message: stable, so a message handed again is the same to the agent. */
  messageIdOf(fleetId: FleetId, messageId: MessageId): string;
  /** The idempotency key of a reply: the same event of the same task is one reply. */
  replyKeyOf(fleetId: FleetId, of: { taskId: string; event: string }): string;
}

/**
 * What the gateway keeps of a message to an outside agent, so a restart never sends again what may have run, and follows on:
 * - sending: handed, and SendMessage sent or about to be;
 * - notSent: the agent was not reached, so nothing ran;
 * - answered: the agent answered with a message or refused it; the reply kept, then sent, acknowledged and handled;
 * - following: the agent took it as its task; acknowledged, and followed until it ends;
 * - mayHaveRun: sent with no answer, and the agent is not repeatable;
 * - done: handled.
 */
export interface AgentCall {
  readonly deliveryId: DeliveryId;
  readonly fleetId: FleetId;
  readonly party: string;
  readonly messageId: MessageId;
  readonly senderShipId: ShipId;
  readonly state: 'sending' | 'notSent' | 'answered' | 'following' | 'mayHaveRun' | 'done';
  /** The agent's task: the one a follow-up continues while sending, its own once it took it. */
  readonly taskId: string | null;
  readonly contextId: string | null;
  /** When the gateway gives up following and replies failed (the gateway's timing). */
  readonly deadlineAt: Date;
  /** The reply to the agent's answer, once it answered with a message or refused: sent again as the same reply when the delivery comes again. */
  readonly answer: AgentAnswer | null;
  /** What each reply of the follow was, by the event's identity: kept, so a restart sends none again. */
  readonly replied: readonly string[];
  /** Where the next chunk of each artifact goes, as the replies so far leave it. */
  readonly chunkPlaces: ChunkPlaces;
}

/** A reply as the gateway sends it: its content, and what its idempotency key derives from. */
export interface AgentAnswer {
  readonly contentType: string;
  readonly payload: string;
  readonly key: string;
}

interface Caller { fleetId: FleetId; party: string }

/** Outbound port: the gateway's messages to outside agents, by delivery, and which task each reply it sent tells of. */
export interface AgentCalls {
  find(caller: Caller, deliveryId: DeliveryId): Promise<AgentCall | undefined>;
  save(call: AgentCall): Promise<void>;
  /** The party's calls whose task is still followed. */
  following(caller: Caller): Promise<AgentCall[]>;
  /** Keeps that this reply tells of this task, so an answer to it continues the task. */
  saveReply(caller: Caller, reply: { messageId: MessageId; taskId: string; contextId: string }): Promise<void>;
  taskOfReply(caller: Caller, messageId: MessageId): Promise<{ taskId: string; contextId: string } | undefined>;
}

/** Outbound port: the fleet's calls an outside agent's proxy ship's crew makes; a reply is a send that answers its message id. */
export type AgentShipCrew = Pick<ProxyShipCrew, 'pushReceive' | 'handed' | 'ack' | 'handled' | 'notHandled'> & CallSender;
