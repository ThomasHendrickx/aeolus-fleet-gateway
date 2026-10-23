'use server';

/**
 * One outside party's forms, as the account signed in (decision 0056):
 * changing its owner and scopes, and retiring it. Each asks the API, which
 * checks the account's scopes; a refusal is said on the form.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { inFleet } from '../../lib/gateway-api/page-account';
import { refusalMessageOf, requestApi } from '../../lib/gateway-api/page-api';
import { FLEET_FIELD, fieldOf, fieldsOf, type FormState } from '../forms/form-state';
import { OUTSIDE_PARTIES_PATH, partyPath } from '../outside-parties/paths';
import { changesOf } from './scope-changes';
import { switchedMessageOf } from './switched-message';

/** The field a party's form names it by. */
const NAME_FIELD = 'name';

export async function changeParty(_previous: FormState, form: FormData): Promise<FormState> {
  const fleetId = fieldOf(form, FLEET_FIELD);
  const name = fieldOf(form, NAME_FIELD);
  const api = await requestApi(fleetId);
  try {
    const [party, account] = await Promise.all([api.parties.get.query({ name }), api.account.inView.query()]);
    const changes = changesOf(party, { form: fieldsOf(form), scopes: account.kind === 'signedIn' ? account.scopes : [] });
    if (changes.kind === 'refused') {
      return changes;
    }
    if (changes.ownerShipId !== undefined) {
      await api.parties.changeOwner.mutate({ name, ownerShipId: changes.ownerShipId });
    }
    if (changes.grant.length > 0 || changes.revoke.length > 0) {
      await api.parties.changeScopes.mutate({ name, grant: changes.grant, revoke: changes.revoke });
    }
  } catch (error) {
    return { kind: 'refused', message: refusalMessageOf(error) };
  }
  redirect(inFleet(partyPath(name), fleetId));
}

/** How one tool's switch ended: as it stands now and what the fleet sees, or why the API refused it. */
export type ToolSwitchState = { kind: 'idle' } | { kind: 'switched'; isOn: boolean; message: string } | { kind: 'refused'; message: string };

export async function switchPartyTool(_previous: ToolSwitchState, form: FormData): Promise<ToolSwitchState> {
  const fleetId = fieldOf(form, FLEET_FIELD);
  const name = fieldOf(form, NAME_FIELD);
  const api = await requestApi(fleetId);
  try {
    const { tool, isOn, statementRefusal } = await api.parties.switchTool.mutate({ name, tool: fieldOf(form, 'tool'), isOn: fieldOf(form, 'isOn') === 'true' });
    revalidatePath(partyPath(name));
    return { kind: 'switched', isOn, message: switchedMessageOf({ tool, isOn, statementRefusal }) };
  } catch (error) {
    return { kind: 'refused', message: refusalMessageOf(error) };
  }
}

export async function retireParty(_previous: FormState, form: FormData): Promise<FormState> {
  const fleetId = fieldOf(form, FLEET_FIELD);
  const api = await requestApi(fleetId);
  try {
    await api.parties.retire.mutate({ name: fieldOf(form, NAME_FIELD) });
  } catch (error) {
    return { kind: 'refused', message: refusalMessageOf(error) };
  }
  redirect(inFleet(OUTSIDE_PARTIES_PATH, fleetId));
}
