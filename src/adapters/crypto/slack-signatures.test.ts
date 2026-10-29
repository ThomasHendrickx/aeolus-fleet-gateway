import { describe, expect, it } from 'vitest';

import { createSlackSignatures } from './slack-signatures.js';

// Slack's own worked example of a signed request (api.slack.com,
// "Verifying requests from Slack").
const SECRET = '8f742231b10e8888abcd99yyyzzz85a5';
const TIMESTAMP = '1531420618';
const BODY =
  'token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c';
const SIGNATURE = 'v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503';

describe("Slack's request signature", () => {
  it("takes Slack's worked example", () => {
    expect(createSlackSignatures().isSigned({ secret: SECRET, timestamp: TIMESTAMP, body: BODY, signature: SIGNATURE })).toBe(true);
  });

  it('refuses another secret, a changed body, a changed timestamp and a signature of another length', () => {
    const signatures = createSlackSignatures();

    expect([
      signatures.isSigned({ secret: 'another-secret', timestamp: TIMESTAMP, body: BODY, signature: SIGNATURE }),
      signatures.isSigned({ secret: SECRET, timestamp: TIMESTAMP, body: `${BODY}&x=1`, signature: SIGNATURE }),
      signatures.isSigned({ secret: SECRET, timestamp: '1531420619', body: BODY, signature: SIGNATURE }),
      signatures.isSigned({ secret: SECRET, timestamp: TIMESTAMP, body: BODY, signature: 'v0=short' }),
    ]).toEqual([false, false, false, false]);
  });
});
