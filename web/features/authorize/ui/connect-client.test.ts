import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ConnectClient } from './connect-client';

const CLIENT = { clientId: 'https://cursor.example.com/client.json', clientName: 'Cursor', redirectUri: 'http://127.0.0.1:7777/callback' };
const FIELDS: [string, string][] = [
  ['response_type', 'code'],
  ['client_id', CLIENT.clientId],
  ['state', 's&1'],
];

/** The page's markup as a browser receives it. */
function shown(): string {
  return renderToStaticMarkup(createElement(ConnectClient, { client: CLIENT, fields: FIELDS }));
}

function textOf(markup: string): string {
  return markup.replaceAll(/<[^>]*>/g, '').replaceAll('&#x27;', "'");
}

describe("the pick page shows the client and its two picks, each starting the sign-in through the gateway's door", () => {
  it('names the client asking, the client it is and where it is sent back', () => {
    const text = textOf(shown());

    expect([text.includes("Cursor asks to call your fleet's ships"), text.includes(`Client ${CLIENT.clientId}, sent back to ${CLIENT.redirectUri}.`)]).toEqual([true, true]);
  });

  it('sends the request on to /authorize/sign-in, with the pick pressed', () => {
    const markup = shown();
    const form = /<form [^>]*>/.exec(markup)?.[0] ?? '';
    const picks = [...markup.matchAll(/<button ([^>]*)><strong>([^<]*)<\/strong>/g)].map(([, attributes = '', label]) => ({
      name: /name="([^"]*)"/.exec(attributes)?.[1],
      value: /value="([^"]*)"/.exec(attributes)?.[1],
      label,
    }));

    expect({ isGet: form.includes('method="get"'), isToSignIn: form.includes('action="/authorize/sign-in"'), picks }).toEqual({
      isGet: true,
      isToSignIn: true,
      picks: [
        { name: 'holder', value: 'account', label: 'Sign in as yourself' },
        { name: 'holder', value: 'party', label: 'Ask for access for this client' },
      ],
    });
  });

  it('carries every parameter of the request as it came', () => {
    const hidden = [...shown().matchAll(/<input type="hidden" name="([^"]*)" value="([^"]*)"\/>/g)].map(([, name, value]) => [name, value?.replaceAll('&amp;', '&')]);

    expect(hidden).toEqual(FIELDS);
  });
});
