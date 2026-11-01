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

const WAITING = { decide: 2, do: 1, 'stay-aware': 0, 'everything-else': undefined };

function render(isSlackLinked = true): string {
  return renderToStaticMarkup(createElement(RoutingPanel, { fleetId: 'flt_01', routing: ROUTING, isSlackLinked, waitingByJob: WAITING }));
}

describe("Bridge's routing page", () => {
  it('lists each job with a switch per place, saying which are on', () => {
    const markup = render();

    expect({
      jobs: (markup.match(/data-testid="bridge-routing-job"/g) ?? []).length,
      decideSlack: /role="switch"[^>]*aria-checked="true"[^>]*data-testid="bridge-routing-decide-slack"/.test(markup),
      doSlack: /role="switch"[^>]*aria-checked="false"[^>]*data-testid="bridge-routing-do-slack"/.test(markup),
      awareWebPush: /role="switch"[^>]*aria-checked="true"[^>]*data-testid="bridge-routing-stay-aware-web-push"/.test(markup),
    }).toEqual({ jobs: 4, decideSlack: true, doSlack: true, awareWebPush: true });
  });

  it("shows Bridge on for every job, a switch that cannot be turned, saying Always", () => {
    const markup = render();

    expect({
      locked: (markup.match(/role="switch"[^>]*aria-checked="true"[^>]*disabled=""[^>]*data-testid="bridge-routing-[a-z-]+-bridge"/g) ?? []).length,
      always: (markup.match(/data-testid="bridge-routing-job"/g) ?? []).length <= (markup.match(/>Always</g) ?? []).length,
    }).toEqual({ locked: 4, always: true });
  });

  it("says Bots only beside Slack's switch for everything else while it is off", () => {
    const markup = render();

    expect(/data-testid="bridge-routing-everything-else-slack"[^]*?Bots only/.test(markup)).toBe(true);
  });

  it('names each job by what it holds', () => {
    const markup = render();

    expect(['Questions from your ships', 'Steps: sign in, create, approve', 'Alerts and notices', 'Replies and other messages'].every((caption) => markup.includes(caption))).toBe(true);
  });

  it('lets no place be turned on that the gateway does not offer, or Slack before it is linked', () => {
    const markup = render(false);

    expect({
      email: /disabled=""[^>]*data-testid="bridge-routing-decide-email"/.test(markup),
      slack: /disabled=""[^>]*data-testid="bridge-routing-do-slack"/.test(markup),
      chat: /disabled=""[^>]*data-testid="bridge-routing-do-chat"/.test(markup),
    }).toEqual({ email: true, slack: true, chat: false });
  });
});
