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

function textOf(markup: string): string {
  return markup.replaceAll(/<[^>]*>/g, ' ').replaceAll(/\s+/g, ' ').trim();
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
