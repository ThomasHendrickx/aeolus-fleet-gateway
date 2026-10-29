import type { FleetId } from '@aeolus-fleet/common';

import type { IsServed } from '../installation/served.js';
import { err, ok, type Result } from '../shared/result.js';
import type { AccountOfSignIn } from './account-of-sign-in.js';
import type { OpenableApps, SharedAccountToken, SharedSignIn } from './ports.js';

/** The app every account may open (header design H1), where an account with nothing else to open goes. */
const ACCOUNT_APP = 'account';
const GATEWAY_APP = 'gateway';

/**
 * Where a page goes for its account:
 * - signedIn: it shows the fleet as the account, by this token;
 * - goTo: it asked for no fleet, and goes to this one;
 * - off: it asked for no fleet, may open the gateway in none, and the gateway is off for this fleet of its (#1233);
 * - elsewhere: the account may not open the gateway there, and goes to an app it may open (H9).
 */
export type AccountInViewAnswer =
  | { readonly kind: 'signedIn'; readonly fleetId: FleetId; readonly token: SharedAccountToken }
  | { readonly kind: 'goTo'; readonly fleetId: FleetId }
  | { readonly kind: 'off'; readonly fleetName: string; readonly accountUrl: string }
  | { readonly kind: 'elsewhere'; readonly url: string };

/** Why a page has no account: no shared sign-in, or one that ended (signedOut), or pagasae did not answer. */
export type AccountInViewRefusal = { readonly kind: 'signedOut' } | { readonly kind: 'pagasaeUnavailable' };

export type AccountInView = (asked: { signIn: string | undefined; fleetId: FleetId | undefined }) => Promise<Result<AccountInViewAnswer, AccountInViewRefusal>>;

/** The first app the account may open in the fleet, else Account; none at all is no answer pagasae gives. */
function elsewhere(openable: OpenableApps, fleetId: FleetId | undefined): AccountInViewAnswer {
  const inFleet = openable.fleets.find((fleet) => fleet.fleetId === fleetId)?.apps.find((app) => app.app !== GATEWAY_APP);
  return { kind: 'elsewhere', url: inFleet?.url ?? accountUrlOf(openable) };
}

function accountUrlOf(openable: OpenableApps): string {
  return openable.apps.find((app) => app.app === ACCOUNT_APP)?.url ?? '/';
}

/** The first of the account's fleets the gateway is off for, said so; else elsewhere. */
async function offOrElsewhere(openable: OpenableApps, isServed: IsServed): Promise<AccountInViewAnswer> {
  for (const fleet of openable.fleets) {
    if (!(await isServed(fleet.fleetId))) {
      return { kind: 'off', fleetName: fleet.name, accountUrl: accountUrlOf(openable) };
    }
  }
  return elsewhere(openable, undefined);
}

/**
 * Use case: the account a page of the gateway shows the fleet in its address
 * as (orchestrator-1, 21 Oct: `?fleet=<fleet id>`, so two tabs show two
 * fleets and a link opens the same one). With no fleet asked for, the page
 * goes to the first fleet whose gateway the account may open (header design
 * H1). Where the account holds no right, it goes to an app it may open
 * there, Account at least (H9). Where it may open none because the gateway
 * is off for its fleet, the page says so instead (Thomas, 25 Oct: "Say it
 * is off, and who turns it on").
 */
export function createAccountInView(deps: { signIns: Pick<SharedSignIn, 'apps'>; accountOf: AccountOfSignIn; isServed: IsServed }): AccountInView {
  const openable = async (signIn: string, fleetId: FleetId | undefined): Promise<Result<AccountInViewAnswer, AccountInViewRefusal>> => {
    const apps = await deps.signIns.apps(signIn);
    if (!apps.isOk) {
      return err(apps.error.kind === 'signedOut' ? { kind: 'signedOut' } : { kind: 'pagasaeUnavailable' });
    }
    if (fleetId !== undefined) {
      return ok(elsewhere(apps.value, fleetId));
    }
    const gateway = apps.value.fleets.find((fleet) => fleet.apps.some((app) => app.app === GATEWAY_APP));
    return ok(gateway === undefined ? await offOrElsewhere(apps.value, deps.isServed) : { kind: 'goTo', fleetId: gateway.fleetId });
  };

  return async ({ signIn, fleetId }) => {
    if (signIn === undefined) {
      return err({ kind: 'signedOut' });
    }
    if (fleetId === undefined) {
      return openable(signIn, undefined);
    }
    const token = await deps.accountOf({ signIn, fleetId });
    if (token.isOk) {
      return ok({ kind: 'signedIn', fleetId, token: token.value });
    }
    switch (token.error.kind) {
      case 'noRights':
        return openable(signIn, fleetId);
      case 'signedOut':
        return err({ kind: 'signedOut' });
      case 'unavailable':
        return err({ kind: 'pagasaeUnavailable' });
    }
  };
}
