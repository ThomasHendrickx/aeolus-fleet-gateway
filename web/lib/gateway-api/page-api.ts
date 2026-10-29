/**
 * The gateway's API for a page of the web app and for its forms (server
 * actions): as the browser that asked, by its cookies, at the address the
 * gateway's server gave the web app, never one a request names.
 */
import { TRPCClientError } from '@trpc/client';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import type { GatewayRouter } from '../../../src/adapters/trpc/router.js';
import { gatewayApi, type GatewayApi } from './gateway-api';
import { FLEET_PARAMETER, inFleet, pageAccountOf, type InView, type InViewRefusal } from './page-account';

/** Set by the gateway's server as it starts the web app (src/adapters/web/next-web-app.ts). */
const API_URL_VARIABLE = 'AEOLUS_GATEWAY_API_URL';

/** A page's search parameters, as Next.js hands them over. */
export type SearchParams = Record<string, string | string[] | undefined>;

/** A page shown as the account signed in: the API as it, its fleet and its scopes there. */
export interface SignedInPage {
  kind: 'signedIn';
  api: GatewayApi;
  fleetId: string;
  scopes: readonly string[];
}

/** The page that says the gateway is off for the account's fleet. */
export const GATEWAY_OFF_PATH = '/gateway-off';

/** Where the page that says the gateway is off sends an account once it may open the gateway. */
const OVERVIEW_PATH = '/overview';

/** The gateway's own address, where the API answers. */
export function apiUrl(): string {
  const url = process.env[API_URL_VARIABLE];
  if (url === undefined) {
    throw new Error(`${API_URL_VARIABLE} is not set: the gateway's server starts the web app`);
  }
  return url;
}

/** The API as the browser that asked, in the fleet named. */
export async function requestApi(fleetId: string | undefined): Promise<GatewayApi> {
  return gatewayApi({ url: apiUrl(), cookie: (await headers()).get('cookie') ?? undefined, fleetId });
}

function isApiRefusal(error: unknown): error is TRPCClientError<GatewayRouter> {
  return error instanceof TRPCClientError;
}

/** The code the API refused a call with, if it refused it. */
export function refusalCodeOf(error: unknown): string | undefined {
  return isApiRefusal(error) ? error.data?.code : undefined;
}

/** Why the API refused a call, as it says it; anything else is no refusal and is thrown on. */
export function refusalMessageOf(error: unknown): string {
  if (!isApiRefusal(error)) {
    throw error;
  }
  return error.message;
}

function isInViewRefusal(code: string | undefined): code is InViewRefusal {
  return code === 'UNAUTHORIZED' || code === 'NOT_FOUND';
}

/** The API's answer to account.inView for the API given, the refusals a page answers included. */
async function inViewOf(api: GatewayApi): Promise<{ inView: InView } | { refusal: InViewRefusal }> {
  try {
    return { inView: await api.account.inView.query() };
  } catch (error) {
    const code = refusalCodeOf(error);
    if (!isInViewRefusal(code)) {
      throw error;
    }
    return { refusal: code };
  }
}

/**
 * The page as the account signed in, in the fleet its address names; or
 * the browser is sent where it may go, the page that says the gateway is
 * off for the account's fleet included. A gateway that signs no one in to
 * its pages answers noSignIn.
 */
export async function signedInPage(page: { path: string; searchParams: SearchParams }): Promise<SignedInPage | { kind: 'noSignIn' }> {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(page.searchParams)) {
    if (typeof value === 'string') {
      query.set(name, value);
    }
  }
  const fleet = query.get(FLEET_PARAMETER) ?? undefined;
  const asked = query.size === 0 ? page.path : `${page.path}?${query.toString()}`;
  const api = await requestApi(fleet);
  const account = pageAccountOf(await inViewOf(api), asked);
  switch (account.kind) {
    case 'goTo':
      return redirect(account.location);
    case 'off':
      return redirect(GATEWAY_OFF_PATH);
    case 'noSignIn':
      return account;
    case 'signedIn':
      return { kind: 'signedIn', api, fleetId: account.fleetId, scopes: account.scopes };
  }
}

/**
 * The page that says the gateway is off for the account's fleet: its name
 * and the way back to its account; once the account may open the gateway,
 * the browser goes to the Overview.
 */
export async function gatewayOffPage(): Promise<{ kind: 'off'; fleetName: string; accountUrl: string } | { kind: 'noSignIn' }> {
  const account = pageAccountOf(await inViewOf(await requestApi(undefined)), OVERVIEW_PATH);
  switch (account.kind) {
    case 'goTo':
      return redirect(account.location);
    case 'signedIn':
      return redirect(inFleet(OVERVIEW_PATH, account.fleetId));
    case 'off':
    case 'noSignIn':
      return account;
  }
}

/** What a page reads from the API, or why the API refused it, for the page to say in its place, with the code it refused with. */
export type Read<T> = { isOk: true; value: T } | { isOk: false; refusal: string; code: string | undefined };

export async function readOf<T>(call: Promise<T>): Promise<Read<T>> {
  try {
    return { isOk: true, value: await call };
  } catch (error) {
    return { isOk: false, refusal: refusalMessageOf(error), code: refusalCodeOf(error) };
  }
}
