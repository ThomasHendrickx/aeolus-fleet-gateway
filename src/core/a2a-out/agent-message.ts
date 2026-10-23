/**
 * A delivery to an outside A2A agent's proxy ship, as the A2A message the
 * gateway sends the agent (slice 6): A7 the other way, so an A2A client
 * reading it back gets what the sender wrote. Text travels as one text part
 * and JSON as one data part, each with the delivery's media type; an
 * `application/a2a+json` delivery is the A2A Message itself, sent whole with
 * the gateway's ids put in; any other type travels as one text part.
 */
import { A2A_CONTENT_TYPE, essenceOf } from '../mcp-in/client-call.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';

/** One part of an A2A message or artifact the gateway reads: text, data, or another kind it carries but does not read. */
export type AgentPart = { readonly kind: 'text'; readonly text: string; readonly mediaType: string } | { readonly kind: 'data'; readonly data: unknown; readonly mediaType: string } | { readonly kind: 'other' };

/** The message the gateway sends an outside agent: its parts, or the A2A Message the sender wrote, as JSON. */
export interface OutboundMessage {
  readonly messageId: string;
  /** The task a follow-up continues, none for a new one. */
  readonly taskId: string | null;
  readonly contextId: string | null;
  readonly content: { readonly kind: 'parts'; readonly parts: readonly AgentPart[] } | { readonly kind: 'whole'; readonly message: Readonly<Record<string, unknown>> };
}

const isJson = (essence: string) => essence === 'application/json' || essence.endsWith('+json');

function parsed(payload: string): { isParsed: true; value: unknown } | { isParsed: false } {
  try {
    return { isParsed: true, value: JSON.parse(payload) };
  } catch {
    return { isParsed: false };
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function outboundMessageOf(
  delivery: { contentType: string; payload: string },
  ids: { messageId: string; taskId: string | null; contextId: string | null },
): Result<OutboundMessage, DomainError<'NOT_A_MESSAGE'>> {
  const essence = essenceOf(delivery.contentType);
  if (essence === A2A_CONTENT_TYPE) {
    const message = parsed(delivery.payload);
    return message.isParsed && isObject(message.value)
      ? ok({ ...ids, content: { kind: 'whole', message: message.value } })
      : refuse('NOT_A_MESSAGE', `An ${A2A_CONTENT_TYPE} payload is an A2A Message as a JSON object`);
  }
  if (isJson(essence)) {
    const data = parsed(delivery.payload);
    return data.isParsed ? ok({ ...ids, content: { kind: 'parts', parts: [{ kind: 'data', data: data.value, mediaType: delivery.contentType }] } }) : refuse('NOT_A_MESSAGE', `A ${delivery.contentType} payload is JSON`);
  }
  return ok({ ...ids, content: { kind: 'parts', parts: [{ kind: 'text', text: delivery.payload, mediaType: delivery.contentType }] } });
}
