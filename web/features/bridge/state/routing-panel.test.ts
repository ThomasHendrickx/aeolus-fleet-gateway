import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { RoutingView } from '../services/routing';
import { RoutingPanel } from './routing-panel';

// Bridge's routing page (Bridge, section 8; the routing mockup): per job,
// each place on or off, Bridge always on; a place the person cannot use
// yet cannot be turned on.

const PLACES_OFF = { slack: false, chat: true, 'web-push': false, email: false };

const ROUTING: RoutingView = {
  offered: { slack: true, chat: true, 'web-push': true, email: false },
  jobs: [
    { job: 'decide', places: { ...PLACES_OFF, slack: true } },
    { job: 'do', places: PLACES_OFF },
    { job: 'stay-aware', places: { ...PLACES_OFF, 'web-push': true } },
    { job: 'everything-else', places: PLACES_OFF },
  ],
};

function render(isSlackLinked = true): string {
  return renderToStaticMarkup(createElement(RoutingPanel, { fleetId: 'flt_01', routing: ROUTING, isSlackLinked }));
}

describe("Bridge's routing page", () => {
  it('lists each job with Bridge always on and a switch per place, saying which are on', () => {
    const markup = render();

    expect({
      jobs: (markup.match(/data-testid="bridge-routing-job"/g) ?? []).length,
      always: (markup.match(/Always/g) ?? []).length,
      decideSlack: /data-testid="bridge-routing-decide-slack"[^>]*aria-pressed="true"/.test(markup),
      doSlack: /data-testid="bridge-routing-do-slack"[^>]*aria-pressed="false"/.test(markup),
      awareWebPush: /data-testid="bridge-routing-stay-aware-web-push"[^>]*aria-pressed="true"/.test(markup),
    }).toEqual({ jobs: 4, always: 4, decideSlack: true, doSlack: true, awareWebPush: true });
  });

  it('names each job by what it holds', () => {
    const markup = render();

    expect(['Questions from your ships', 'Steps: sign in, create, approve', 'Alerts and notices', 'Replies and other messages'].every((caption) => markup.includes(caption))).toBe(true);
  });

  it('lets no place be turned on that the gateway does not offer, or Slack before it is linked', () => {
    const markup = render(false);

    expect({
      email: /data-testid="bridge-routing-decide-email"[^>]*disabled=""/.test(markup),
      slack: /data-testid="bridge-routing-do-slack"[^>]*disabled=""/.test(markup),
      chat: /data-testid="bridge-routing-do-chat"[^>]*disabled=""/.test(markup),
    }).toEqual({ email: true, slack: true, chat: false });
  });
});
