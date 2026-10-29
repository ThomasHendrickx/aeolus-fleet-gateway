'use server';

/**
 * One outside party's forms, as the account signed in (decision 0056):
 * changing its owner and scopes, switching a server's tools and setting the
 * scopes a party needs, marking an A2A agent repeatable or not, signing in
 * to a server for yourself and removing that sign-in (decision 0067), and retiring it. Each asks the API, which
 * checks the account's scopes; a refusal is said on the form.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { inFleet } from '../../lib/gateway-api/page-account';
import { refusalCodeOf, refusalMessageOf, requestApi } from '../../lib/gateway-api/page-api';
import { FLEET_FIELD, fieldOf, fieldsOf, type FormState } from '../forms/form-state';
import { OUTSIDE_PARTIES_PATH, partyPath } from '../outside-parties/paths';
import { changesOf } from './scope-changes';
import { markedMessageOf } from './marked-message';
import { REMOVED, SIGN_IN_PARAMETER } from './own-sign-in';

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

/** How a change on a party's page ended (gateway scopes 4.3): kept, at the requirements' new version when it changed them, or refused with why, CONFLICT told apart for its Reload. */
export type TableOutcome = { isOk: true; version: number | null; statementRefusal: string | null } | { isOk: false; message: string; isConflict: boolean };

function refusedOutcome(error: unknown): TableOutcome {
  return { isOk: false, message: refusalMessageOf(error), isConflict: refusalCodeOf(error) === 'CONFLICT' };
}

/** Sets the scopes a party needs, its own set when sent and each tool's sent, all at once on the version the page read. */
export async function setPartyScopes(change: { fleetId: string; name: string; version: number; party?: string[]; tools: { tool: string; scopes: string[] }[] }): Promise<TableOutcome> {
  const { fleetId, ...input } = change;
  const api = await requestApi(fleetId);
  try {
    const { version, statementRefusal } = await api.parties.setScopeRequirements.mutate(input);
    revalidatePath(partyPath(input.name));
    return { isOk: true, version, statementRefusal };
  } catch (error) {
    return refusedOutcome(error);
  }
}

/** Switches the tools selected on a server's page on or off, in one change. */
export async function switchPartyTools(change: { fleetId: string; name: string; tools: string[]; isOn: boolean }): Promise<TableOutcome> {
  const { fleetId, ...input } = change;
  const api = await requestApi(fleetId);
  try {
    const { statementRefusal } = await api.parties.switchTools.mutate(input);
    revalidatePath(partyPath(input.name));
    return { isOk: true, version: null, statementRefusal };
  } catch (error) {
    return refusedOutcome(error);
  }
}

/** How an A2A agent's repeatable mark ended: as it stands now and what it means, or why the API refused it. */
export type MarkState = { kind: 'idle' } | { kind: 'marked'; isRepeatable: boolean; message: string } | { kind: 'refused'; message: string };

export async function markA2aAgent(_previous: MarkState, form: FormData): Promise<MarkState> {
  const fleetId = fieldOf(form, FLEET_FIELD);
  const name = fieldOf(form, NAME_FIELD);
  const api = await requestApi(fleetId);
  try {
    const { isRepeatable, statementRefusal } = await api.parties.markA2aAgent.mutate({ name, isRepeatable: fieldOf(form, 'isRepeatable') === 'true' });
    revalidatePath(partyPath(name));
    return { kind: 'marked', isRepeatable, message: markedMessageOf({ name, isRepeatable, statementRefusal }) };
  } catch (error) {
    return { kind: 'refused', message: refusalMessageOf(error) };
  }
}

/** A person signs in to a server where each person signs in, for themselves: their browser goes to its authorization server. */
export async function signInToParty(_previous: FormState, form: FormData): Promise<FormState> {
  const api = await requestApi(fieldOf(form, FLEET_FIELD));
  let url: string;
  try {
    ({ url } = await api.parties.startSignIn.mutate({ name: fieldOf(form, NAME_FIELD) }));
  } catch (error) {
    return { kind: 'refused', message: refusalMessageOf(error) };
  }
  redirect(url);
}

/** A person removes their own sign-in to a server: the page then says it is removed. */
export async function removeOwnSignIn(_previous: FormState, form: FormData): Promise<FormState> {
  const fleetId = fieldOf(form, FLEET_FIELD);
  const name = fieldOf(form, NAME_FIELD);
  const api = await requestApi(fleetId);
  try {
    await api.parties.removeOwnSignIn.mutate({ name });
  } catch (error) {
    return { kind: 'refused', message: refusalMessageOf(error) };
  }
  redirect(inFleet(`${partyPath(name)}?${new URLSearchParams({ [SIGN_IN_PARAMETER]: REMOVED }).toString()}`, fleetId));
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
