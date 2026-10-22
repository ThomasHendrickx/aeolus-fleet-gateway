/*
 * The switcher in the title of the header the gateway's pages show
 * (aeolus-fleet, header design H1, H9), from the apps and fleets the account
 * may open as the gateway's API answers them. The fleet in view is the one
 * the page's address names; a layout cannot read the address, so the server
 * offers one switcher per listed fleet and the header picks by the address.
 */
import { accountIdSchema, headerAppSchema, idSchema, type AppLink, type AppsList } from '@aeolus-fleet/common';
import { appSwitcherOf, type AppSwitcherModel } from '@aeolus-fleet/common/header';

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
