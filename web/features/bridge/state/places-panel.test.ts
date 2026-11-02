import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { RoutingView } from '../services/routing';
import { PlacesPanel } from './places-panel';

// Where things show (Bridge, section 8; the routing mockup): the places on
// top, each with its state and its one action.

const ROUTING: RoutingView = {
  offered: { slack: true, chat: true, 'web-push': true, email: true },
  jobs: [{ job: 'decide', places: { slack: true, chat: true, 'web-push': true, email: false } }],
};

function render(): string {
  return renderToStaticMarkup(
    createElement(PlacesPanel, {
      fleetId: 'flt_01',
      routing: ROUTING,
      slackLink: { workspaceName: 'Aeolus', link: { slackName: 'thomas' } },
      chats: ['claude.ai'],
      webPush: { publicKey: 'BKey', browsers: [] },
    }),
  );
}

/** One place's card: from its own start to the next card's. */
function card(markup: string, place: string): string {
  const [, after = ''] = markup.split(`data-testid="bridge-place-${place}"`);
  return after.split(/data-testid="bridge-place-(?:slack|chat|web-push|email)"/)[0] ?? '';
}

describe("Where things show's places", () => {
  it('shows each place with its state and its one action', () => {
    const markup = render();

    expect({
      slack: ['Linked', 'As @thomas in Aeolus.', 'Unlink'].every((text) => card(markup, 'slack').includes(text)),
      chat: ['Connected', 'claude.ai, through the gateway.'].every((text) => card(markup, 'chat').includes(text)),
      webPush: ['Off', 'Turn on'].every((text) => card(markup, 'web-push').includes(text)),
      email: ['Off', 'Nothing is on until you turn it on.', 'Turn on'].every((text) => card(markup, 'email').includes(text)),
    }).toEqual({ slack: true, chat: true, webPush: true, email: true });
  });
});
