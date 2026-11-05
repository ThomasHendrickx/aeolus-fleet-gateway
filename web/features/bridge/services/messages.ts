/**
 * Plain messages in Bridge (#242, design/bridge-messages): a ship's message
 * to the person in text/plain or text/markdown, outside the count, until
 * the person marks it done. Its first line is its title, its text beneath,
 * both as plain words with the Markdown marks taken off; home lists the 3
 * newest, the Messages page every one. Pure view logic, no React and no API
 * client.
 */

/** How many of the newest messages home lists; the rest are a click away. */
export const HOME_MESSAGES = 3;

/** A Markdown text as plain words: headings, quotes, list marks, emphasis and code marks taken off, a link and an image by their words, lines joined. */
export function plainTextOf(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*(?:>\s*)*/, '')
        .replace(/^#{1,6}\s+/, '')
        .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/(\*\*|__|~~|`)/g, '')
        .replace(/(^|\W)[*_](\S(?:.*?\S)?)[*_](?=\W|$)/g, '$1$2')
        .trim(),
    )
    .filter((line) => line !== '')
    .join(' ');
}

/** What the home's Messages heading says beside it: how many are new, outside the count. */
export function messagesSaidOf(newCount: number): string {
  return newCount === 0 ? 'outside the count' : `${String(newCount)} new, outside the count`;
}

export function showAllSaidOf(count: number): string {
  return `Show all ${String(count)} messages`;
}

/** The line on top of a phone's Waiting tab, leading to the new messages listed far below. */
export function newMessagesSaidOf(newCount: number): string {
  return newCount === 1 ? '1 new message' : `${String(newCount)} new messages`;
}

/** What the Messages page says under its heading: how many are new and seen, and that each stays until done. */
export function messagesPageSaidOf({ newCount, seenCount }: { newCount: number; seenCount: number }): string {
  const counts = [newCount === 0 ? null : `${String(newCount)} new`, seenCount === 0 ? null : `${String(seenCount)} seen`].filter((said) => said !== null).join(', ');
  return `${counts}. Outside the count; each stays until you mark it done.`;
}

/** The words of marking the seen messages done in one go: the button, the question it asks first, its confirmation and its working label. */
export function markSeenDoneOf({ seenCount, newCount }: { seenCount: number; newCount: number }): { button: string; question: string; confirm: string; pending: string } {
  const seen = String(seenCount);
  const newOnes = newCount === 0 ? '' : ` The ${String(newCount)} new ${newCount === 1 ? 'one stays' : 'ones stay'}.`;
  return { button: `Mark the ${seen} seen done`, question: `Mark the ${seen} seen ${seenCount === 1 ? 'message' : 'messages'} done?${newOnes}`, confirm: `Mark ${seen} done`, pending: 'Marking done...' };
}

/** What marking the seen ones done did: how many, that they are in Done, and which it could not mark, kept. */
export function markedDoneSaidOf({ done, failed }: { done: number; failed: readonly string[] }): string {
  const said = `${String(done)} ${done === 1 ? 'message' : 'messages'} marked done. They are in Done.`;
  return failed.length === 0 ? said : `${said} Not marked done: ${failed.map((title) => `“${title}”`).join(', ')}; the fleet did not answer. Try again.`;
}

/** What a row says when its Done did not end the message: the fleet's own words, or that it did not answer. */
export const NOT_MARKED_DONE = 'Not marked done: the fleet did not answer. Try again.';
