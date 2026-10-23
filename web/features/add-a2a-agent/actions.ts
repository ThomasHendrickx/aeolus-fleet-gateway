'use server';

/**
 * Adding an outside A2A agent by its card address (slice 5), as the account
 * signed in: the API checks it holds gateway:approve and grants only scopes
 * it holds, and the gateway reads the card before it commissions anything.
 * Added, the page goes to the agent's own page.
 */
import { idSchema } from '@aeolus-fleet/common';
import { redirect } from 'next/navigation';

import { inFleet } from '../../lib/gateway-api/page-account';
import { refusalMessageOf, requestApi } from '../../lib/gateway-api/page-api';
import { tickedScopes } from '../add-a2a-client/ticked-scopes';
import { FLEET_FIELD, fieldOf, fieldsOf } from '../forms/form-state';
import { serverCredentialOf } from '../forms/server-credential';
import { partyPath } from '../outside-parties/paths';

/** The fields that never travel back to the browser: the credential's secrets. */
const SECRET_FIELDS: ReadonlySet<string> = new Set(['token', 'clientSecret']);

/** Where adding stands: not sent, or refused with why and what the browser sent, its secrets aside. */
export type AddA2aAgentState = { kind: 'idle' } | { kind: 'refused'; message: string; fields: Record<string, string> };

export async function addA2aAgent(_previous: AddA2aAgentState, form: FormData): Promise<AddA2aAgentState> {
  const fleetId = fieldOf(form, FLEET_FIELD);
  const fields = Object.fromEntries(Object.entries(fieldsOf(form)).filter(([field]) => !SECRET_FIELDS.has(field)));
  const ownerShipId = idSchema('ship').safeParse(fieldOf(form, 'ownerShipId'));
  if (!ownerShipId.success) {
    return { kind: 'refused', message: 'Pick its owner', fields };
  }
  const api = await requestApi(fleetId);
  let name: string;
  try {
    const added = await api.parties.addA2aAgent.mutate({
      requestId: fieldOf(form, 'requestId'),
      name: fieldOf(form, 'name'),
      cardUrl: fieldOf(form, 'cardUrl'),
      credential: serverCredentialOf({
        credentialKind: fieldOf(form, 'credentialKind'),
        token: fieldOf(form, 'token'),
        clientId: fieldOf(form, 'clientId'),
        clientSecret: fieldOf(form, 'clientSecret'),
        issuer: fieldOf(form, 'issuer'),
        scope: fieldOf(form, 'scope'),
      }),
      concurrencyLimit: Number(fieldOf(form, 'concurrencyLimit')),
      ownerShipId: ownerShipId.data,
      scopes: tickedScopes(fieldsOf(form)),
    });
    name = added.name;
  } catch (error) {
    return { kind: 'refused', message: refusalMessageOf(error), fields };
  }
  redirect(inFleet(partyPath(name), fleetId));
}
