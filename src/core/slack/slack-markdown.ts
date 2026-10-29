import type { SlackFile } from './slack-event.js';

/** Slack's escapes in a message's text, and what each stands for. */
const ESCAPES: readonly (readonly [string, string])[] = [['&lt;', '<'], ['&gt;', '>'], ['&amp;', '&']];

/**
 * A person's Slack message as the Markdown the gateway sends to the fleet
 * (gateway scopes 9.4 step 5): the mention of the bot removed, Slack's bold
 * and strike, links, people and channels turned into Markdown, Slack's
 * escapes undone, and each shared file added as its Slack link. Italics and
 * code read the same in both.
 */
export function markdownOf(message: { text: string; botUserId: string; files: readonly SlackFile[] }): string {
  const { text, botUserId, files } = message;
  let markdown = text
    .replaceAll(new RegExp(`<@${botUserId}(\\|[^>]*)?>`, 'g'), '')
    .replaceAll(/<@[A-Z0-9]+\|([^>]+)>/g, '@$1')
    .replaceAll(/<@([A-Z0-9]+)>/g, '@$1')
    .replaceAll(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
    .replaceAll(/<(https?:[^|>]+)\|([^>]+)>/g, '[$2]($1)')
    .replaceAll(/<(https?:[^>]+)>/g, '$1')
    .replaceAll(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, '$1**$2**')
    .replaceAll(/(^|[\s(])~([^~\n]+)~(?=$|[\s).,!?:;])/g, '$1~~$2~~');
  for (const [escape, character] of ESCAPES) {
    markdown = markdown.replaceAll(escape, character);
  }
  const links = files.map(({ name, permalink }) => `[${name}](${permalink})`);
  return [markdown.trim(), ...links].filter((part) => part !== '').join('\n\n');
}
