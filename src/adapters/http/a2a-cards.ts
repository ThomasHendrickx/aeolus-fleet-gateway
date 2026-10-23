/**
 * The A2A agent cards the gateway serves per alias (decision 0060). The
 * public card says only how to call: the gateway as provider, the alias's
 * interface, the bearer scheme and that an extended card exists. The
 * extended card adds the ship's statement for the caller, as the fleet's
 * discover answered it to the caller's proxy ship: its summary, and each
 * capability as a skill.
 */
import type { AgentCard, AgentSkill } from '@a2a-js/sdk';

import type { ReachedShip } from '../../core/a2a-in/list-reached-ships.js';
import type { Capability } from '../../core/mcp-in/ports.js';
import { runningVersion } from './version.js';

/** The A2A version the gateway speaks; a client sends it as `A2A-Version`. */
export const A2A_VERSION = '1.0';

/** Where each alias's A2A calls go, under the gateway's public URL. */
export const A2A_PATH = '/gw/a2a';

/** An alias as the gateway derives it: a letter, then seven of lowercase base32. */
export const ALIAS_PATTERN = /^[a-z][a-z2-7]{7}$/;

const BEARER_SCHEME = 'bearer';

/** What a ship with no statement of its crew's says: what any caller may learn before it is added. */
const PUBLIC_DESCRIPTION = 'A ship of an Aeolus fleet, behind its gateway. Call with the bearer you were given for its extended card, which says what it offers.';

/** What an A2A client sends and gets back without a capability naming its modes: plain text or JSON (decision 0060). */
const DEFAULT_MODES = ['text/plain', 'application/json'];

/** The address of an alias's A2A interface. */
export function a2aInterfaceUrlOf(issuer: string, alias: string): string {
  return `${issuer}${A2A_PATH}/${alias}`;
}

/** The address of an alias's public card, which a party's owner hands its client. */
export function a2aCardAddressOf(issuer: string, alias: string): string {
  return `${a2aInterfaceUrlOf(issuer, alias)}/.well-known/agent-card.json`;
}

/** An alias's public card: no summary and no skills. */
export function publicCardOf(issuer: string, alias: string): AgentCard {
  return {
    name: alias,
    description: PUBLIC_DESCRIPTION,
    supportedInterfaces: [
      { url: a2aInterfaceUrlOf(issuer, alias), protocolBinding: 'JSONRPC', tenant: '', protocolVersion: A2A_VERSION },
      { url: a2aInterfaceUrlOf(issuer, alias), protocolBinding: 'HTTP+JSON', tenant: '', protocolVersion: A2A_VERSION },
    ],
    provider: { organization: 'Aeolus gateway', url: issuer },
    version: runningVersion(),
    capabilities: { streaming: false, pushNotifications: false, extensions: [], extendedAgentCard: true },
    securitySchemes: { [BEARER_SCHEME]: { scheme: { $case: 'httpAuthSecurityScheme', value: { description: 'The bearer shown once when your client was added', scheme: 'Bearer', bearerFormat: '' } } } },
    securityRequirements: [{ schemes: { [BEARER_SCHEME]: { list: [] } } }],
    defaultInputModes: DEFAULT_MODES,
    defaultOutputModes: DEFAULT_MODES,
    skills: [],
    signatures: [],
  };
}

function skillOf(capability: Capability): AgentSkill {
  return {
    id: capability.name,
    name: capability.title ?? capability.name,
    description: capability.description ?? '',
    tags: [],
    examples: [],
    inputModes: capability.inputModes ?? [],
    outputModes: capability.outputModes ?? [],
    securityRequirements: [],
  };
}

/** A reached ship's extended card: the public card with its crew's statement, if it stated one. */
export function extendedCardOf(issuer: string, ship: ReachedShip): AgentCard {
  const card = publicCardOf(issuer, ship.alias);
  const { statement } = ship;
  if (statement?.by !== 'crew') {
    return card;
  }
  return { ...card, description: statement.summary, skills: statement.capabilities.map(skillOf) };
}
