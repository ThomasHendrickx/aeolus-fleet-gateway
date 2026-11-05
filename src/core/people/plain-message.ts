/**
 * A plain message to the person (Bridge #242): a delivery of text/plain or
 * text/markdown, which asks nothing by convention, so it is outside what
 * waits, and stays in Bridge's Messages until the person marks it done. Any
 * other content type of everything else, such as a withdrawal or an answer in
 * a thread, is in the record only.
 */
import { essenceOf } from './item-job.js';

const PLAIN_MESSAGE_CONTENT_TYPES: ReadonlySet<string> = new Set(['text/plain', 'text/markdown']);

/** The longest text after its first line Bridge lists, so a message's payload never travels whole to a list. */
export const EXCERPT_MAX_LENGTH = 280;

export function isPlainMessage(contentType: string): boolean {
  return PLAIN_MESSAGE_CONTENT_TYPES.has(essenceOf(contentType));
}

/** The text after a message's first line, its title, trimmed and cut to the longest Bridge lists. */
export function excerptOf(payload: string): string {
  const firstBreak = payload.indexOf('\n');
  return firstBreak === -1 ? '' : payload.slice(firstBreak + 1).trim().slice(0, EXCERPT_MAX_LENGTH);
}
