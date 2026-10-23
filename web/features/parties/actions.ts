'use server';

/**
 * The Parties page's forms, for an account holding fleet:manage: approving
 * an outside MCP server, handing over a secret, stating a party and marking
 * its tools. Each asks the API as the account, which checks its scopes.
 */
import { idSchema } from '@aeolus-fleet/common';
import { revalidatePath } from 'next/cache';

import { refusalMessageOf, requestApi } from '../../lib/gateway-api/page-api';
import type { GatewayApi } from '../../lib/gateway-api/gateway-api';
import { FLEET_FIELD, fieldOf, type FormState } from '../forms/form-state';
import { serverCredentialOf } from '../forms/server-credential';
import { PARTIES_PATH } from './paths';

/** Calls the API as the account in the form's fleet: done says what changed, a refusal why. */
async function asAccount(form: FormData, call: (api: GatewayApi) => Promise<string>): Promise<FormState> {
  const api = await requestApi(fieldOf(form, FLEET_FIELD));
  let message: string;
  try {
    message = await call(api);
  } catch (error) {
    return { kind: 'refused', message: refusalMessageOf(error) };
  }
  revalidatePath(PARTIES_PATH);
  return { kind: 'done', message };
}

export async function approveParty(_previous: FormState, form: FormData): Promise<FormState> {
  const ownerShipId = idSchema('ship').safeParse(fieldOf(form, 'ownerShipId'));
  if (!ownerShipId.success) {
    return { kind: 'refused', message: "The owner's ship id is not a ship id (shp_...)" };
  }
  const scope = fieldOf(form, 'scope');
  return asAccount(form, async (api) => {
    const approved = await api.parties.approve.mutate({
      requestId: fieldOf(form, 'requestId'),
      name: fieldOf(form, 'name'),
      url: fieldOf(form, 'url'),
      credential: serverCredentialOf({ credentialKind: fieldOf(form, 'credentialKind'), token: fieldOf(form, 'token'), clientId: fieldOf(form, 'clientId'), clientSecret: fieldOf(form, 'clientSecret'), issuer: fieldOf(form, 'issuer'), scope }),
      ownerShipId: ownerShipId.data,
      concurrencyLimit: Number(fieldOf(form, 'concurrencyLimit')),
    });
    return `${approved.name} is approved`;
  });
}

export async function crewParty(_previous: FormState, form: FormData): Promise<FormState> {
  return asAccount(form, async (api) => {
    const crewed = await api.parties.crew.mutate({ name: fieldOf(form, 'name'), secret: fieldOf(form, 'secret') });
    return `${crewed.name} is crewed`;
  });
}

export async function stateParty(_previous: FormState, form: FormData): Promise<FormState> {
  const name = fieldOf(form, 'name');
  return asAccount(form, async (api) => {
    await api.parties.state.mutate({ name });
    return `${name}'s tools are stated`;
  });
}

export async function markTool(_previous: FormState, form: FormData): Promise<FormState> {
  const tool = fieldOf(form, 'tool');
  return asAccount(form, async (api) => {
    await api.parties.markTool.mutate({ name: fieldOf(form, 'name'), tool, isRepeatable: fieldOf(form, 'isRepeatable') === 'on' });
    return `${tool} is marked`;
  });
}
