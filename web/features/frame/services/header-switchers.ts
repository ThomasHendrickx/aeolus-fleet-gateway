/*
 * The switcher in the title of the header the gateway's pages show
 * (aeolus-fleet, header design H1, H9), from the apps and fleets the account
 * may open as the gateway's API answers them. The fleet in view is the one
 * the page's address names; a layout cannot read the address, so the server
 * offers one switcher per listed fleet and the header picks by the address.
 */
import { accountIdSchema, headerAppSchema, idSchema, type AppLink, type AppsList } from '@aeolus-fleet/common';
import { appSwitcherOf, type AppSwitcherModel } from '@aeolus-fleet/common/rules';

/** The apps and fleets the account may open, as the API's account.apps answers them. */
export interface AccountApps {
  account: { id: string; email: string };
  apps: readonly { app: string; url: string }[];
  fleets: readonly { id: string; name: string; apps: readonly { app: string; url: string }[] }[];
}

const fleetIdSchema = idSchema('fleet');

/** The apps the header knows (H12), the others left out; the addresses as the API answers them. */
function headerAppsOf(apps: AccountApps['apps']): AppLink[] {
  return apps.flatMap(({ app, url }) => {
    const known = headerAppSchema.safeParse(app);
    return known.success ? [{ app: known.data, url }] : [];
  });
}

/** The switchers for the gateway, one per listed fleet with it in view; none for an answer with a malformed id. */
export function headerSwitchersOf(answer: AccountApps): AppSwitcherModel[] {
  const accountId = accountIdSchema.safeParse(answer.account.id);
  const fleetIds = answer.fleets.map((fleet) => fleetIdSchema.safeParse(fleet.id));
  if (!accountId.success || fleetIds.some((fleetId) => !fleetId.success)) {
    return [];
  }
  const list: AppsList = {
    account: { id: accountId.data, email: answer.account.email },
    apps: headerAppsOf(answer.apps),
    // Whether the account may sign in as argo is the console's alone: the gateway's header never shows it.
    fleets: answer.fleets.flatMap((fleet, index) => {
      const fleetId = fleetIds[index];
      return fleetId?.success === true ? [{ id: fleetId.data, name: fleet.name, argo: false, apps: headerAppsOf(fleet.apps) }] : [];
    }),
  };
  return list.fleets.map(({ id, name }) => appSwitcherOf({ list, fleet: { id, name }, app: 'gateway' }));
}

/** Where the gateway at this address opens a fleet. */
function gatewayInFleet(gatewayUrl: string, fleetId: string): string {
  const address = new URL(gatewayUrl);
  address.searchParams.set('fleet', fleetId);
  return address.toString();
}

/**
 * The switcher on a page of the gateway (H9): choosing a fleet this gateway
 * opens in opens the same page there; any other fleet is left as the switcher
 * offers it.
 */
export function switcherOnPage(switcher: AppSwitcherModel, page: string): AppSwitcherModel {
  const gateway = switcher.apps.find(({ app }) => app === 'gateway');
  if (gateway === undefined) {
    return switcher;
  }
  const fleets = switcher.fleets.map((fleet) => {
    if (fleet.url !== gatewayInFleet(gateway.url, fleet.id)) {
      return fleet;
    }
    // The page's path alone, at this gateway: what the page shows in the fleet in view stays behind.
    const address = new URL(gateway.url);
    address.pathname = page;
    address.search = new URLSearchParams({ fleet: fleet.id }).toString();
    return { ...fleet, url: address.toString() };
  });
  return { ...switcher, fleets };
}
