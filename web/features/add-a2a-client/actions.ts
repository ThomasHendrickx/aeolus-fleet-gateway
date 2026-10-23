'use server';

/**
 * Adding an outside A2A client (decision 0060), as the account signed in:
 * the API checks it holds gateway:approve and grants only scopes it holds,
 * then answers the client's bearer, which the page shows once.
 */
import { idSchema } from '@aeolus-fleet/common';

import { refusalMessageOf, requestApi } from '../../lib/gateway-api/page-api';
import { FLEET_FIELD, fieldOf, fieldsOf } from '../forms/form-state';
import { tickedScopes } from './ticked-scopes';

/** Where adding stands: not sent, refused with why, or added with the bearer to hand the client. */
export type AddA2aClientState = { kind: 'idle' } | { kind: 'refused'; message: string } | { kind: 'added'; name: string; bearer: string };

export async function addA2aClient(_previous: AddA2aClientState, form: FormData): Promise<AddA2aClientState> {
  const ownerShipId = idSchema('ship').safeParse(fieldOf(form, 'ownerShipId'));
  if (!ownerShipId.success) {
    return { kind: 'refused', message: 'Pick its owner' };
  }
  const api = await requestApi(fieldOf(form, FLEET_FIELD));
  try {
    const added = await api.parties.addA2aClient.mutate({ requestId: fieldOf(form, 'requestId'), name: fieldOf(form, 'name'), ownerShipId: ownerShipId.data, scopes: tickedScopes(fieldsOf(form)) });
    return { kind: 'added', name: added.party.name, bearer: added.bearer };
  } catch (error) {
    return { kind: 'refused', message: refusalMessageOf(error) };
  }
}
