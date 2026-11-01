import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SlackDroppedOut } from './slack-dropped-out';

// A place fails (Bridge, section 9): Slack drops out and Bridge says why,
// leading to where things show (states.html).

describe('Slack dropped out', () => {
  const markup = renderToStaticMarkup(createElement(SlackDroppedOut, { fleetId: 'flt_01', botName: 'Aeolus fleet' }));

  it("says the fleet's own bot was removed, by its name, and that everything still shows in Bridge and a chat", () => {
    expect({
      title: markup.includes('>Slack dropped out<'),
      why: markup.includes('The Aeolus fleet bot was removed from your workspace, so Slack shows nothing. Everything still shows here and in a chat.'),
    }).toEqual({ title: true, why: true });
  });

  it('leads to where things show', () => {
    expect(/<a[^>]*href="\/bridge\/settings\/routing\?fleet=flt_01"[^>]*>.*Where things show<\/a>/.test(markup)).toBe(true);
  });
});

describe('Slack dropped out on the phone', () => {
  it("is left out, as the phone's frame draws it", () => {
    const markup = renderToStaticMarkup(createElement(SlackDroppedOut, { fleetId: 'flt_01', botName: 'Aeolus fleet' }));

    expect(/<section[^>]*data-testid="bridge-slack-dropped-out"[^>]*class="[^"]*max-sm:hidden/.test(markup)).toBe(true);
  });
});
