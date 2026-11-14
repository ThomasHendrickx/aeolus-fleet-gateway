import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { AddServerState } from '../actions';
import { AddressStep } from './address-step';
import { OwnerStep } from './owner-step';
import { SignInStep } from './sign-in-step';

// Adding a server where each person signs in, as M1 shows it (decision 0067, slice S7).

const FLEET = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const ATTIO = 'https://mcp.attio.com/mcp';
const SIGN_IN_FIELDS = { url: ATTIO, credentialKind: 'personSignIn' };
const OWNER: Extract<AddServerState, { step: 'owner' }> = {
  step: 'owner',
  fields: SIGN_IN_FIELDS,
  tools: null,
  owners: [{ shipId: 'shp_01m3tb1zgr5h2ffee12xnch8sw', name: 'mathilde' }],
  requestId: 'a-request',
};
const ignored = () => undefined;

/** A step's text as a person reads it: React's form script, its tags and its escapes gone. */
function textOf(markup: string): string {
  return markup.replaceAll(/<script>.*?<\/script>/gs, '').replaceAll(/<[^>]*>/g, ' ').replaceAll('&#x27;', "'").replaceAll(/\s+/g, ' ').trim();
}

function addressStep(fields: Record<string, string>): string {
  return renderToStaticMarkup(createElement(AddressStep, { state: { fields }, action: ignored, fleetId: FLEET }));
}

function ownerStep(refusal?: string): string {
  const refused = refusal === undefined ? { kind: 'idle' as const } : { kind: 'refused' as const, requestId: OWNER.requestId, fields: { ...SIGN_IN_FIELDS, name: 'attio' }, message: refusal };
  return renderToStaticMarkup(createElement(OwnerStep, { state: OWNER, refused, action: ignored, onBack: ignored, fleetId: FLEET, canSwitchTools: true }));
}

describe('adding a server where each person signs in (M1)', () => {
  it('offers Each person signs in beside the credentials the vault keeps', () => {
    const markup = addressStep({});

    expect([...markup.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map(([, kind, label]) => `${kind ?? ''}: ${label ?? ''}`)).toEqual([
      'none: No credential',
      'bearer: Bearer token',
      'clientCredentials: OAuth client credentials',
      'personSignIn: Each person signs in',
    ]);
  });

  it('numbers its steps Address, Owner, Sign in, says how each person signs in, and goes on with Next', () => {
    const text = textOf(addressStep(SIGN_IN_FIELDS));

    expect(text).toContain('1 Address 2 Owner 3 Sign in');
    expect(text).toContain("Each person signs in for themselves. A ship calls under its owner's sign-in.");
    expect(text).toMatch(/ Next$/);
  });

  it('keeps the steps Address, Check, Owner and the check for any other credential', () => {
    const text = textOf(addressStep({ url: ATTIO, credentialKind: 'bearer' }));

    expect(text).toContain('1 Address 2 Check 3 Owner');
    expect(text).toMatch(/ Check the server$/);
  });

  it('asks for its owner with no tools to switch, which show once someone signs in', () => {
    const markup = ownerStep();

    expect(textOf(markup)).toContain('1 Address 2 Owner 3 Sign in');
    expect(textOf(markup)).toContain('Its owner');
    expect(textOf(markup)).toContain('Its tools show once someone signs in.');
    expect(textOf(markup)).toContain('Add attio');
    expect(markup).not.toContain('data-testid="add-server-tools"');
    expect(markup).toContain('name="credentialKind" value="personSignIn"');
  });

  it("says the sign-in check's refusal in place on the owner step", () => {
    const markup = ownerStep('The authorization server https://app.attio.com does not state PKCE S256');

    expect(textOf(markup)).toContain('Its owner The authorization server https://app.attio.com does not state PKCE S256');
    expect(markup).toContain('role="alert"');
  });

  it("says the server is added, with the approver's own sign-in next, or later on its page", () => {
    const markup = renderToStaticMarkup(createElement(SignInStep, { fleetId: FLEET, name: 'attio' }));

    expect(textOf(markup)).toBe('1 Address 2 Owner 3 Sign in attio is added. Sign in to attio for yourself. Its tools show after the first sign-in. Sign in to attio Later');
    expect(markup).toContain(`href="/outside-parties/attio?fleet=${FLEET}"`);
    expect(markup).toContain('name="name" value="attio"');
  });
});


describe('the supplied sign-in client fields', () => {
  it('offers automatic registration or a dedicated supplied client explicitly', () => {
    expect(textOf(addressStep(SIGN_IN_FIELDS))).toContain('Automatic registration');
    expect(textOf(addressStep(SIGN_IN_FIELDS))).toContain('Supplied client');
  });

  it.each(['none', 'client_secret_post', 'client_secret_basic'])('shows the callback and supplied %s fields', (method) => {
    const markup = renderToStaticMarkup(createElement(AddressStep, { state: { fields: { ...SIGN_IN_FIELDS, signInClientSource: 'fixed', signInClientAuthMethod: method, signInClientId: 'dedicated' } }, action: ignored, fleetId: FLEET, redirectUri: 'https://public.gateway.example/outside-parties/sign-in/done' }));
    expect(textOf(markup)).toContain('https://public.gateway.example/outside-parties/sign-in/done');
    expect(textOf(markup)).toContain('dedicated to this server');
    expect(markup).toContain('name="signInClientId"');
    expect(markup.includes('name="signInClientSecret"')).toBe(method !== 'none');
  });

  it('carries the supplied identity through the owner step', () => {
    const markup = renderToStaticMarkup(createElement(OwnerStep, { state: { ...OWNER, fields: { ...SIGN_IN_FIELDS, signInClientSource: 'fixed', signInClientId: 'dedicated', signInClientSecret: 'secret', signInClientAuthMethod: 'client_secret_basic' } }, refused: { kind: 'idle' }, action: ignored, onBack: ignored, fleetId: FLEET, canSwitchTools: true }));
    expect(markup).toContain('name="signInClientSource" value="fixed"');
    expect(markup).toContain('name="signInClientId" value="dedicated"');
    expect(markup).toContain('name="signInClientAuthMethod" value="client_secret_basic"');
  });
});


describe('the approved plain gateway URL form', () => {
  it('offers the explicit URL choice with the approved guidance, exact callback and public fields only', () => {
    const markup = renderToStaticMarkup(createElement(AddressStep, { state: { fields: { ...SIGN_IN_FIELDS, signInClientSource: 'url' } }, action: ignored, fleetId: FLEET, redirectUri: 'https://public.gateway.example/outside-parties/sign-in/done' }));
    const text = textOf(markup);
    expect(text).toContain('Gateway URL');
    expect(text).toContain('URL mode');
    expect(text).toContain('Plain URL');
    expect(text).toContain('The gateway creates a distinct public client URL for this server. No client secret is needed.');
    expect(text).toContain('Choose this only if the service accepts a URL as its client id and allows this exact callback:');
    expect(text).toContain('https://public.gateway.example/outside-parties/sign-in/done');
    expect(text).toContain('Adding checks discovery and client settings. Sign in afterwards to check that the service accepts the client and callback.');
    expect(text).not.toContain('The service must advertise client metadata document support.');
    expect(markup).not.toContain('name="signInClientId"');
    expect(markup).not.toContain('name="signInClientSecret"');
    expect(markup).not.toContain('name="signInClientAuthMethod"');
  });

  it('carries the URL choice to addition through the owner step', () => {
    const markup = renderToStaticMarkup(createElement(OwnerStep, { state: { ...OWNER, fields: { ...SIGN_IN_FIELDS, signInClientSource: 'url' } }, refused: { kind: 'idle' }, action: ignored, onBack: ignored, fleetId: FLEET, canSwitchTools: true }));
    expect(markup).toContain('name="signInClientSource" value="url"');
  });
});


describe('the approved metadata document form (after-document-idle)', () => {
  const documentFields = { ...SIGN_IN_FIELDS, signInClientSource: 'url', signInClientUrlMode: 'document' };

  it('offers Metadata document with the approved guidance, exact callback and public fields only', () => {
    const markup = renderToStaticMarkup(createElement(AddressStep, { state: { fields: documentFields }, action: ignored, fleetId: FLEET, redirectUri: 'https://public.gateway.example/outside-parties/sign-in/done' }));
    const text = textOf(markup);
    expect(text).toContain('The gateway creates a distinct public client URL for this server. No client secret is needed.');
    expect(markup).toContain('<option value="document" selected="">Metadata document</option>');
    expect(text).toContain('The service must advertise client metadata document support. The gateway publishes the client URL with this exact callback:');
    expect(text).not.toContain('Choose this only if the service accepts a URL as its client id');
    expect(text).toContain('https://public.gateway.example/outside-parties/sign-in/done');
    expect(text).toContain('Adding checks discovery and client settings. Sign in afterwards to check that the service accepts the client and callback.');
    expect(markup).not.toContain('name="signInClientSecret"');
  });

  it('carries the document mode to addition through the owner step', () => {
    const markup = renderToStaticMarkup(createElement(OwnerStep, { state: { ...OWNER, fields: documentFields }, refused: { kind: 'idle' }, action: ignored, onBack: ignored, fleetId: FLEET, canSwitchTools: true }));
    expect(markup).toContain('name="signInClientUrlMode" value="document"');
  });

  it('shows the unadvertised document refusal on the owner step (after-document-document-unsupported)', () => {
    const message = 'The authorization server does not advertise client metadata document support. Choose another client option or check the service configuration.';
    expect(textOf(ownerStep(message))).toContain(message);
  });
});
