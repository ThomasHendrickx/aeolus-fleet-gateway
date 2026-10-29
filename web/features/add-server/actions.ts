'use server';

/**
 * Adding an outside MCP server (design B, screen 7; flow F10), as the
 * account signed in: the gateway's check of the tools it answers with,
 * which keeps nothing, then approving it with its owner. A server where each
 * person signs in is not checked before: approving it checks its sign-in
 * (M1, decision 0067). Each step asks the API, which checks the account
 * holds fleet:manage.
 */
import { randomUUID } from 'node:crypto';

import { idSchema } from '@aeolus-fleet/common';
import { redirect } from 'next/navigation';

import { inFleet } from '../../lib/gateway-api/page-account';
import { refusalMessageOf, requestApi } from '../../lib/gateway-api/page-api';
import { FLEET_FIELD, fieldOf, fieldsOf } from '../forms/form-state';
import { addedServerCredentialOf, SIGN_IN_CREDENTIAL } from '../forms/server-credential';
import type { OwnerChoice } from '../forms/ui/owner-field';
import { partyPath } from '../outside-parties/paths';
import { toolChoiceOf } from './tool-choice';

/** The tools a server answered the check with. */
export interface CheckedTool {
  name: string;
  description?: string | undefined;
  isReadOnly: boolean;
}

/**
 * Where adding a server stands: the address step, or the owner step after
 * the check answered its tools, with the ships its owner may be picked
 * from. A server where each person signs in has no tools before someone
 * signs in: null. The address and credential travel on in the fields, as
 * the browser sent them.
 */
export type AddServerState =
  | { step: 'address'; fields: Record<string, string>; refusal?: string }
  | { step: 'owner'; fields: Record<string, string>; tools: CheckedTool[] | null; owners: OwnerChoice[]; requestId: string };

function credentialOf(form: FormData) {
  return addedServerCredentialOf({
    credentialKind: fieldOf(form, 'credentialKind'),
    token: fieldOf(form, 'token'),
    clientId: fieldOf(form, 'clientId'),
    clientSecret: fieldOf(form, 'clientSecret'),
    issuer: fieldOf(form, 'issuer'),
    scope: fieldOf(form, 'scope'),
  });
}

export async function checkServer(_previous: AddServerState, form: FormData): Promise<AddServerState> {
  const fields = fieldsOf(form);
  const api = await requestApi(fieldOf(form, FLEET_FIELD));
  const credential = credentialOf(form);
  try {
    const tools = credential.kind === SIGN_IN_CREDENTIAL.kind ? null : (await api.parties.check.mutate({ url: fieldOf(form, 'url'), credential })).tools;
    const owners = await api.parties.ownerChoices.query();
    return { step: 'owner', fields, tools, owners, requestId: randomUUID() };
  } catch (error) {
    return { step: 'address', fields, refusal: refusalMessageOf(error) };
  }
}

/**
 * An approval refused, for the owner step of the check it came from, with
 * what the browser sent; or a server where each person signs in added, whose
 * approver signs in next (Q15). Any other server added goes to its page.
 */
export type ApproveState = { kind: 'idle' } | { kind: 'refused'; requestId: string; fields: Record<string, string>; message: string } | { kind: 'added'; name: string };

export async function approveServer(_previous: ApproveState, form: FormData): Promise<ApproveState> {
  const fleetId = fieldOf(form, FLEET_FIELD);
  const fields = fieldsOf(form);
  const requestId = fieldOf(form, 'requestId');
  const ownerShipId = idSchema('ship').safeParse(fieldOf(form, 'ownerShipId').trim());
  if (!ownerShipId.success) {
    return { kind: 'refused', requestId, fields, message: "The owner's ship id is not a ship id (shp_...)" };
  }
  const api = await requestApi(fleetId);
  const credential = credentialOf(form);
  let name: string;
  try {
    const approved = await api.parties.approve.mutate({
      requestId,
      name: fieldOf(form, 'name'),
      url: fieldOf(form, 'url'),
      credential,
      ownerShipId: ownerShipId.data,
      concurrencyLimit: Number(fieldOf(form, 'concurrencyLimit')),
      tools: toolChoiceOf(form),
    });
    name = approved.name;
  } catch (error) {
    return { kind: 'refused', requestId, fields, message: refusalMessageOf(error) };
  }
  if (credential.kind === SIGN_IN_CREDENTIAL.kind) {
    return { kind: 'added', name };
  }
  redirect(inFleet(partyPath(name), fleetId));
}
