/**
 * An outside A2A agent's proxy ship's statement (slice 5), written from its
 * public card: each skill is one capability, by its id, with its name,
 * description and media types, the card's defaults where it names none.
 * The card's interfaces, schemes and signatures stay in the gateway (NAT
 * both ways), and a skill has no schema. Every capability is repeatable,
 * A2A's default, unless the agent is marked not repeatable (A9). A card the
 * gateway cannot call, or that makes no valid statement, is refused with the
 * reason.
 */
import { STATEMENT_SUMMARY_MAX_LENGTH, statementSchema } from '@aeolus-fleet/common';

import type { CallTiming, Capability, Statement } from '../mcp-out/statement.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { AgentCard, AgentInterface, AgentSkill } from './ports.js';

/** The bindings the gateway calls an agent over, at A2A 1.0 (A11). */
const CALLED_BINDINGS: ReadonlySet<string> = new Set(['JSONRPC', 'HTTP+JSON']);
const CALLED_VERSION = /^1\.0(\.\d+)?$/;

const isCalled = (each: AgentInterface) => CALLED_BINDINGS.has(each.protocolBinding) && CALLED_VERSION.test(each.protocolVersion);

function capabilityOf(skill: AgentSkill, of: { card: AgentCard; isRepeatable: boolean; timing: CallTiming }): Capability {
  return {
    name: skill.id,
    title: skill.name,
    description: skill.description,
    inputModes: skill.inputModes.length > 0 ? skill.inputModes : of.card.defaultInputModes,
    outputModes: skill.outputModes.length > 0 ? skill.outputModes : of.card.defaultOutputModes,
    waitMs: of.timing.waitMs,
    deadlineMs: of.timing.deadlineMs,
    ...(of.isRepeatable ? { repeatable: true as const } : {}),
  };
}

export function agentStatementOf(input: { partyName: string; card: AgentCard; isRepeatable: boolean; timing: CallTiming }): Result<Statement, DomainError<'CARD_INVALID'>> {
  const { card } = input;
  if (!card.supportedInterfaces.some(isCalled)) {
    return refuse('CARD_INVALID', 'The card has no interface the gateway calls: JSONRPC or HTTP+JSON at A2A 1.0');
  }
  if (card.skills.length === 0) {
    return refuse('CARD_INVALID', 'The card has no skill to state');
  }
  const statement: Statement = {
    summary: `${input.partyName}, an outside A2A agent reached through the Aeolus gateway: ${card.description}`.slice(0, STATEMENT_SUMMARY_MAX_LENGTH),
    capabilities: card.skills.map((skill) => capabilityOf(skill, { card, isRepeatable: input.isRepeatable, timing: input.timing })),
  };
  const checked = statementSchema.safeParse(statement);
  if (!checked.success) {
    return refuse('CARD_INVALID', `The card makes no valid statement: ${checked.error.issues.map((issue) => issue.message).join('; ')}`);
  }
  return ok(statement);
}
