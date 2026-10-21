'use server';

/**
 * The Outside parties page's form: turning the fleet's outside parties on
 * or off (interop I-3, decision 0056), as the account signed in. On in a
 * fleet with no network rules is refused with the API's warning until the
 * account confirms it.
 */
import { revalidatePath } from 'next/cache';

import { refusalCodeOf, refusalMessageOf, requestApi } from '../../lib/gateway-api/page-api';
import { FLEET_FIELD, fieldOf, type FormState } from '../forms/form-state';
import { OUTSIDE_PARTIES_PATH } from './paths';

export async function switchOutsideParties(_previous: FormState, form: FormData): Promise<FormState> {
  const api = await requestApi(fieldOf(form, FLEET_FIELD));
  const isOn = fieldOf(form, 'isOn') === 'true';
  try {
    await api.outsideParties.set.mutate({ isOn, isOpenNetworkConfirmed: fieldOf(form, 'isOpenNetworkConfirmed') === 'true' });
  } catch (error) {
    const message = refusalMessageOf(error);
    return refusalCodeOf(error) === 'PRECONDITION_FAILED' ? { kind: 'openNetwork', message } : { kind: 'refused', message };
  }
  revalidatePath(OUTSIDE_PARTIES_PATH);
  return { kind: 'done', message: isOn ? 'Outside parties are on' : 'Outside parties are off' };
}
