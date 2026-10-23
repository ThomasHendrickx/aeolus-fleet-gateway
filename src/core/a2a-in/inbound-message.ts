/**
 * An inbound A2A message as the gateway's core reads it (decision 0060):
 * its ids, its parts as far as the content rule tells them apart, and the
 * whole message as A2A JSON. A ship that knows nothing of A2A still reads
 * plain text or JSON, so one text or one data part travels as itself; any
 * other message travels whole, as `application/a2a+json`.
 */
import { A2A_CONTENT_TYPE, isSameMediaType } from '../mcp-in/client-call.js';
import type { Capability } from '../mcp-in/ports.js';

/** A part, as the content rule tells them apart: text, data, or another kind (a file, raw bytes). */
export type InboundPart = { kind: 'text'; text: string; mediaType?: string } | { kind: 'data'; data: unknown; mediaType?: string } | { kind: 'other' };

export interface InboundMessage {
  /** The client's id of the message: the send's idempotency key. */
  messageId: string;
  /** The task it continues, if any. */
  taskId?: string;
  contextId?: string;
  parts: InboundPart[];
  /** The whole message as A2A JSON, as the client sent it. */
  asJson: string;
}

const PLAIN_TEXT = 'text/plain';
const JSON_CONTENT_TYPE = 'application/json';

/** The content type and payload the message travels as. */
export function contentOf(message: InboundMessage): { contentType: string; payload: string } {
  const [only, ...more] = message.parts;
  if (only !== undefined && more.length === 0) {
    switch (only.kind) {
      case 'text':
        return { contentType: only.mediaType ?? PLAIN_TEXT, payload: only.text };
      case 'data':
        return { contentType: only.mediaType ?? JSON_CONTENT_TYPE, payload: JSON.stringify(only.data) };
      case 'other':
        break;
    }
  }
  return { contentType: A2A_CONTENT_TYPE, payload: message.asJson };
}

/** The capability a message of this content type calls: the first whose first input mode equals it; none when no first input mode does. */
export function capabilityFor(capabilities: readonly Capability[], contentType: string): Capability | undefined {
  return capabilities.find((capability) => {
    const [first] = capability.inputModes ?? [];
    return first !== undefined && isSameMediaType(first, contentType);
  });
}
