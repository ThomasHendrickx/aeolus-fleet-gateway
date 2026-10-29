import { describe, expect, it } from 'vitest';

import { markdownOf } from './slack-markdown.js';

// A person's Slack message goes to the fleet as Markdown (gateway scopes
// 9.4 step 5): the mention of the bot removed, Slack's markup turned into
// Markdown, a shared file as its Slack link.

const BOT = 'U0BOT';

describe("a Slack message's text as Markdown", () => {
  it('removes the mention of the bot', () => {
    expect(markdownOf({ text: '<@U0BOT> when is the release?', botUserId: BOT, files: [] })).toBe('when is the release?');
  });

  it("turns Slack's bold, strike and links into Markdown, italics and code as they are", () => {
    expect(markdownOf({ text: '*soon* ~never~ _maybe_ `code` <https://acme.test/notes|the notes> <https://acme.test>', botUserId: BOT, files: [] })).toBe('**soon** ~~never~~ _maybe_ `code` [the notes](https://acme.test/notes) https://acme.test');
  });

  it("names another person and a channel as Slack shows them, and unescapes Slack's escapes", () => {
    expect(markdownOf({ text: 'ask <@U0JORIS|joris> in <#C0LAUNCH|launch>: a &lt; b &amp;&amp; c &gt; d', botUserId: BOT, files: [] })).toBe('ask @joris in #launch: a < b && c > d');
  });

  it('adds each shared file as its Slack link', () => {
    expect(markdownOf({ text: 'here', botUserId: BOT, files: [{ name: 'notes.pdf', permalink: 'https://acme.slack.com/files/U0M/F01/notes.pdf' }] })).toBe('here\n\n[notes.pdf](https://acme.slack.com/files/U0M/F01/notes.pdf)');
  });
});
