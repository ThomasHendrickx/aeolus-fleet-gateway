'use server';

/**
 * The Slack page's forms (gateway scopes 9.1), as the account signed in:
 * connecting a workspace by its configuration token, Install for a bot,
 * which goes on to Slack's install screen, Expose a ship, and Remove and
 * Disconnect, each after its confirm.
 */
import { idSchema } from '@aeolus-fleet/common';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { inFleet } from '../../lib/gateway-api/page-account';
import { refusalMessageOf, requestApi } from '../../lib/gateway-api/page-api';
import { FLEET_FIELD, fieldOf, type FormState } from '../forms/form-state';
import { SLACK_PATH } from './paths';

export async function connectSlack(_previous: FormState, form: FormData): Promise<FormState> {
  const api = await requestApi(fieldOf(form, FLEET_FIELD));
  let isGatewayBotMade: boolean;
  try {
    ({ isGatewayBotMade } = await api.slack.connect.mutate({ refreshToken: fieldOf(form, 'refreshToken') }));
  } catch (error) {
    return { kind: 'refused', message: refusalMessageOf(error) };
  }
  revalidatePath(SLACK_PATH);
  return { kind: 'done', message: isGatewayBotMade ? "Slack is connected, and the gateway's bot is made: install it" : "Slack is connected; Slack did not make the gateway's bot yet: press Install" };
}

/** Install for the gateway's bot, or for the ship's bot the form names. */
export async function installBot(_previous: FormState, form: FormData): Promise<FormState> {
  const api = await requestApi(fieldOf(form, FLEET_FIELD));
  const appId = fieldOf(form, 'appId');
  let url: string;
  try {
    ({ url } = await api.slack.install.mutate(appId === '' ? undefined : { appId }));
  } catch (error) {
    return { kind: 'refused', message: refusalMessageOf(error) };
  }
  redirect(url);
}

export async function disconnectSlack(_previous: FormState, form: FormData): Promise<FormState> {
  const fleetId = fieldOf(form, FLEET_FIELD);
  const api = await requestApi(fleetId);
  try {
    await api.slack.disconnect.mutate();
  } catch (error) {
    return { kind: 'refused', message: refusalMessageOf(error) };
  }
  redirect(inFleet(SLACK_PATH, fleetId));
}

export async function exposeShip(_previous: FormState, form: FormData): Promise<FormState> {
  const fleetId = fieldOf(form, FLEET_FIELD);
  const api = await requestApi(fleetId);
  const shipId = idSchema('ship').safeParse(fieldOf(form, 'shipId'));
  if (!shipId.success) {
    return { kind: 'refused', message: 'Pick a ship to expose' };
  }
  try {
    await api.slack.expose.mutate({ shipId: shipId.data });
  } catch (error) {
    return { kind: 'refused', message: refusalMessageOf(error) };
  }
  redirect(inFleet(SLACK_PATH, fleetId));
}

export async function removeBot(_previous: FormState, form: FormData): Promise<FormState> {
  const fleetId = fieldOf(form, FLEET_FIELD);
  const api = await requestApi(fleetId);
  try {
    await api.slack.remove.mutate({ appId: fieldOf(form, 'appId') });
  } catch (error) {
    return { kind: 'refused', message: refusalMessageOf(error) };
  }
  redirect(inFleet(SLACK_PATH, fleetId));
}
