/**
 * What the header shows, read through the gateway's API by the browser's
 * shared sign-in (header design H1): the account and the apps and fleets it
 * may open. A browser signed in to no account, a gateway that signs no one
 * in to its pages, or pagasae not answering, shows the plain bar: the page
 * itself says what to do.
 */
import { refusalCodeOf, requestApi } from '../../../lib/gateway-api/page-api';
import type { AccountApps } from '../services/header-switchers';

export async function readHeader(): Promise<AccountApps | undefined> {
  try {
    return await (await requestApi(undefined)).account.apps.query();
  } catch (error) {
    if (refusalCodeOf(error) !== undefined) {
      return undefined;
    }
    throw error;
  }
}
