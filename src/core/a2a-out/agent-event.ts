/**
 * What an outside A2A agent tells of a task (slice 6): its status, an
 * artifact, or a message answering with no task, each with the A2A JSON it
 * came as. Each goes back to the sender as one reply (2a): an artifact or
 * message of one text part as that text, of one data part as JSON, so a ship
 * that knows nothing of A2A reads its result; anything else, and every
 * status, as `application/a2a+json`. Following stops at a terminal or
 * interrupted state, and at a message answer.
 */
import { PAYLOAD_MAX_BYTES, payloadBytes } from '@aeolus-fleet/common';

import { A2A_CONTENT_TYPE } from '../mcp-in/client-call.js';
import type { AgentPart } from './agent-message.js';

export type AgentState = 'submitted' | 'working' | 'inputRequired' | 'authRequired' | 'completed' | 'failed' | 'canceled' | 'rejected' | 'unspecified';

/** A status with the time the agent recorded it, if it said; an artifact, whole or a chunk appended to it; a message. */
export type AgentEvent =
  | { readonly kind: 'status'; readonly state: AgentState; readonly timestamp: string | null; readonly json: string }
  | { readonly kind: 'artifact'; readonly artifactId: string; readonly isAppended: boolean; readonly parts: readonly AgentPart[]; readonly json: string }
  | { readonly kind: 'message'; readonly messageId: string; readonly parts: readonly AgentPart[]; readonly json: string };

/** The states after which the agent does nothing more without a new message: ended, or waiting for input or authentication. */
const ENDING_STATES: ReadonlySet<AgentState> = new Set(['completed', 'failed', 'canceled', 'rejected', 'inputRequired', 'authRequired']);

export function endsFollowing(event: AgentEvent): boolean {
  switch (event.kind) {
    case 'status':
      return ENDING_STATES.has(event.state);
    case 'message':
      return true;
    case 'artifact':
      return false;
  }
}

/**
 * What makes an event of a task one reply, as a follow of one fleet message sees them in turn:
 * - a status: the message it answers, its state and its time, so a status told again is one reply and the same state on a follow-up is another;
 * - an artifact: its id and the place of its chunk, so the whole artifact a task read or a new stream starts with is its first chunk again, never its chunks once more;
 * - a message: its id.
 */
export function createEventIdentities(answering: string): (event: AgentEvent) => string {
  /** Per artifact, the place its next appended chunk takes. */
  const nextChunk = new Map<string, number>();
  return (event) => {
    switch (event.kind) {
      case 'status':
        return JSON.stringify(['status', answering, event.state, event.timestamp]);
      case 'artifact': {
        const chunk = event.isAppended ? Math.max(nextChunk.get(event.artifactId) ?? 1, 1) : 0;
        nextChunk.set(event.artifactId, Math.max(nextChunk.get(event.artifactId) ?? 1, chunk + 1));
        return JSON.stringify(['artifact', event.artifactId, chunk]);
      }
      case 'message':
        return JSON.stringify(['message', event.messageId]);
    }
  };
}

const PLAIN_TEXT = 'text/plain';
const JSON_TYPE = 'application/json';

function plainContentOf(event: AgentEvent): { contentType: string; payload: string } {
  const [only, ...more] = event.kind === 'status' ? [] : event.parts;
  if (only !== undefined && more.length === 0) {
    if (only.kind === 'text') {
      return { contentType: only.mediaType, payload: only.text };
    }
    if (only.kind === 'data') {
      return { contentType: JSON_TYPE, payload: JSON.stringify(only.data) };
    }
  }
  return { contentType: A2A_CONTENT_TYPE, payload: event.json };
}

/** The reply's content type and payload; one too large for a message says so instead. */
export function replyContentOf(event: AgentEvent): { contentType: string; payload: string } {
  const content = plainContentOf(event);
  const bytes = payloadBytes(content.payload);
  return bytes > PAYLOAD_MAX_BYTES ? { contentType: PLAIN_TEXT, payload: `The agent's ${event.kind} is ${String(bytes)} bytes, over the ${String(PAYLOAD_MAX_BYTES)} a message holds.` } : content;
}
