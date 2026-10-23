/**
 * The ports of A2A out (slice 5): how the gateway reads an outside A2A
 * agent's card, as the proto's AgentCard states it. Only what the gateway
 * uses is kept: the agent's interfaces it may call, its description, its
 * default modes and its skills.
 */
import type { Result } from '../shared/result.js';

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
  readonly skills: readonly AgentSkill[];
}

/** Why a card could not be read: nothing answered with one, or what answered is no AgentCard. */
export type CardFailure = { kind: 'UNREACHABLE'; reason: string } | { kind: 'NOT_A_CARD'; reason: string };

export interface AgentCards {
  /** The card at its address, read with no credential, as a public card is. */
  read(cardUrl: string): Promise<Result<AgentCard, CardFailure>>;
}
