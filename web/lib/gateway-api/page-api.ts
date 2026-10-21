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
import { FLEET_PARAMETER, pageAccountOf, type InView, type InViewRefusal } from './page-account';

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

function apiUrl(): string {
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

/**
 * The page as the account signed in, in the fleet its address names; or
 * the browser is sent where it may go. A gateway that signs no one in to
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
  let read: { inView: InView } | { refusal: InViewRefusal };
  try {
    read = { inView: await api.account.inView.query() };
  } catch (error) {
    const code = refusalCodeOf(error);
    if (!isInViewRefusal(code)) {
      throw error;
    }
    read = { refusal: code };
  }
  const account = pageAccountOf(read, asked);
  switch (account.kind) {
    case 'goTo':
      return redirect(account.location);
    case 'noSignIn':
      return account;
    case 'signedIn':
      return { kind: 'signedIn', api, fleetId: account.fleetId, scopes: account.scopes };
  }
}

/** What a page reads from the API, or why the API refused it, for the page to say in its place. */
export type Read<T> = { isOk: true; value: T } | { isOk: false; refusal: string };

export async function readOf<T>(call: Promise<T>): Promise<Read<T>> {
  try {
    return { isOk: true, value: await call };
  } catch (error) {
    return { isOk: false, refusal: refusalMessageOf(error) };
  }
}
