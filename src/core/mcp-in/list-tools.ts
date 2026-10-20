/**
 * Use case: the tools an outside MCP client sees (interop 3.3). Each is a
 * capability of a ship its party's proxy ship may send to now, as the fleet's
 * discover answers it: the gateway shows exactly what core answers, and adds
 * no reach of its own.
 */
import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { PartyStore } from '../parties/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { Capability, DiscoveredShip, Discovery, ShipAliases } from './ports.js';

/** The optional argument a client gives so that the same call again sends no second message. */
export const IDEMPOTENCY_ARGUMENT = 'aeolus_idempotency_key';

const IDEMPOTENCY_PROPERTY = {
  type: 'string',
  description: 'Optional. The same key again sends no second message: give one when you may call again after a lost answer.',
};

/** The longest tool name MCP clients take. */
export const TOOL_NAME_MAX_LENGTH = 128;

/** Between a ship's alias and its capability's name in a tool name. */
const TOOL_NAME_SEPARATOR = '__';

/** The media type a capability that names none takes and answers. */
const DEFAULT_MODE = 'application/json';

const TEXT_MODE = 'text/plain';

/** Where a tool's call goes: the ship, its capability, and the content type of the message. */
export interface ToolTarget {
  shipId: ShipId;
  capability: string;
  contentType: string;
  /** Whether the message is the call's one text argument, as plain text, rather than its arguments as JSON. */
  isText: boolean;
  /** The type the answer comes in, the capability's first output mode; none when it states none. */
  outputContentType: string | null;
  /** How long a call waits for its answer, as the capability states it; 0 when it states none. */
  waitMs: number;
  /** How long a call may take before it fails, as the capability states it; none when it states none. */
  deadlineMs: number | null;
}

/** A tool as an MCP client lists it, with where its call goes. */
export interface ListedTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  target: ToolTarget;
}

export type ListToolsRefusal = DomainError<'PARTY_NOT_CREWED' | 'FLEET_UNAVAILABLE'>;

/** Who lists: the fleet and the party its access token names. */
export type ListTools = (caller: { fleetId: FleetId; party: string }) => Promise<Result<ListedTool[], ListToolsRefusal>>;

/** A media type without its parameters, in lower case. */
const essenceOf = (mode: string) => (mode.split(';')[0] ?? '').trim().toLowerCase();

const isJson = (mode: string) => essenceOf(mode) === DEFAULT_MODE || essenceOf(mode).endsWith('+json');

const isObjectSchema = (schema: Record<string, unknown>) => schema.type === 'object';

/** The arguments a capability takes, with the idempotency argument; none for a schema MCP cannot carry. */
function inputSchemaOf(capability: Capability, isText: boolean): Record<string, unknown> | undefined {
  if (isText) {
    return { type: 'object', properties: { text: { type: 'string' }, [IDEMPOTENCY_ARGUMENT]: IDEMPOTENCY_PROPERTY }, required: ['text'] };
  }
  const schema = capability.inputSchema ?? { type: 'object' };
  if (!isObjectSchema(schema)) {
    return undefined;
  }
  const properties = typeof schema.properties === 'object' && schema.properties !== null ? schema.properties : {};
  return { ...schema, properties: { ...properties, [IDEMPOTENCY_ARGUMENT]: IDEMPOTENCY_PROPERTY } };
}

function toolOf({ alias, summary, shipId }: { alias: string; summary: string; shipId: ShipId }, capability: Capability): ListedTool | undefined {
  const contentType = capability.inputModes?.[0] ?? DEFAULT_MODE;
  const isText = essenceOf(contentType) === TEXT_MODE;
  const name = `${alias}${TOOL_NAME_SEPARATOR}${capability.name}`;
  const inputSchema = inputSchemaOf(capability, isText);
  if ((!isText && !isJson(contentType)) || inputSchema === undefined || name.length > TOOL_NAME_MAX_LENGTH) {
    return undefined;
  }
  // No output schema: a call may answer a handle, and MCP clients check every answer against it.
  return {
    name,
    ...(capability.title === undefined ? {} : { title: capability.title }),
    description: [capability.description, `Offered by: ${summary}`].filter((part) => part !== undefined).join('\n\n'),
    inputSchema,
    target: { shipId, capability: capability.name, contentType, isText, outputContentType: capability.outputModes?.[0] ?? null, waitMs: capability.waitMs ?? 0, deadlineMs: capability.deadlineMs ?? null },
  };
}

/** argo is left out: every ship may send to argo, and argo is no tool (Q12). */
function toolsOf(ship: DiscoveredShip, alias: string): ListedTool[] {
  const { statement } = ship;
  if (ship.kind === 'operator' || statement?.by !== 'crew') {
    return [];
  }
  return statement.capabilities.flatMap((capability) => toolOf({ alias, summary: statement.summary, shipId: ship.shipId }, capability) ?? []);
}

export function createListTools(deps: { parties: PartyStore; discovery: Discovery; aliases: ShipAliases }): ListTools {
  return async ({ fleetId, party: name }) => {
    const party = await deps.parties.find(fleetId, name);
    if (party?.kind !== 'mcpClient' || party.state !== 'crewed' || party.crewToken === null) {
      return refuse('PARTY_NOT_CREWED', `The party ${name} is not crewed: argo crews it on the parties page`);
    }
    const discovered = await deps.discovery.discover(party.crewToken);
    if (!discovered.isOk) {
      return refuse('FLEET_UNAVAILABLE', `The fleet did not answer which ships the party reaches: ${discovered.error.message}`);
    }
    return ok(discovered.value.flatMap((ship) => toolsOf(ship, deps.aliases.aliasOf(fleetId, ship.shipId))));
  };
}
