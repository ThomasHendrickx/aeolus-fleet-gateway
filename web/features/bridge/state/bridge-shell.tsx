import type { AppSwitcherModel } from '@aeolus-fleet/common/rules';
import { Suspense, type ReactNode } from 'react';

import type { GatewayApi } from '../../../lib/gateway-api/gateway-api';
import { readHeader } from '../../frame/hooks/read-header';
import { headerSwitchersOf } from '../../frame/services/header-switchers';
import { readTheme } from '../../frame/hooks/read-theme';
import { Frame } from '../../frame/ui/frame';
import { PlainHeader } from '../../frame/ui/plain-header';
import { NoSignIn } from '../../sign-in/ui/no-sign-in';
import { readShellCounts } from '../hooks/read-bridge';
import type { BridgeScreen } from '../services/shell';
import { BridgeSidebar, type ShellCounts } from '../ui/bridge-sidebar';
import { BridgeTabs } from '../ui/bridge-tabs';
import type { PageBelow } from '../ui/bridge-top-bar';
import { KeptRead } from './kept-read';
import { ShellFrame, SidebarPerson, type ShellAccount } from './shell-frame';

/** The shell before its counts are read: none shown, the basket left out. */
const NO_COUNTS: ShellCounts = { waiting: undefined, stayAware: undefined, messages: undefined, basket: 0, fleetAlerts: undefined };

/** The counts once read; while what waits cannot be read, the browser shows them as last read (states.html). */
async function Counted({ counts, children }: { counts: Promise<ShellCounts>; children: (counts: ShellCounts) => ReactNode }) {
  const read = await counts;
  return <KeptRead readAt={read.waiting === undefined ? undefined : new Date().toISOString()}>{children(read)}</KeptRead>;
}

/** The account signed in and the fleet in view by name, as the header's read answers them; none while it cannot be read. */
async function readShellPerson(fleetId: string): Promise<{ account: ShellAccount | undefined; fleetName: string | undefined; switcher?: AppSwitcherModel }> {
  const [answer, theme] = await Promise.all([readHeader(), readTheme()]);
  if (answer === undefined) {
    return { account: undefined, fleetName: undefined };
  }
  return {
    account: { email: answer.account.email, accountUrl: answer.apps.find(({ app }) => app === 'account')?.url, theme },
    switcher: headerSwitchersOf(answer).find(({ fleet }) => fleet.id === fleetId),
    fleetName: answer.fleets.find(({ id }) => id === fleetId)?.name,
  };
}

/**
 * Bridge's shell around each of its pages, in place of the gateway's top
 * bar (docs/design/bridge/mockups; aeolus-fleet#1536): on desktop the
 * sidebar and the top bar with the breadcrumb and Live; on the phone the
 * screen title, the tabs and the basket's bar above them. A page below a
 * screen, such as Add MCP server below Outside parties, is named after it. Its counts
 * are read beside the page, which shows while they load.
 */
export async function BridgeShell({ api, fleetId, screen, below, children }: { api: GatewayApi; fleetId: string; screen: BridgeScreen; below?: PageBelow; children: ReactNode }) {
  const counts = readShellCounts(api);
  // The counts are awaited where they show, after the person is read: a refusal meanwhile is not left unhandled.
  counts.catch(() => undefined);
  const { account, fleetName, switcher } = await readShellPerson(fleetId);
  const sidebar = (shown: ShellCounts) => (
    <BridgeSidebar switcher={switcher} fleetId={fleetId} screen={screen} counts={shown} accountUrl={account?.accountUrl} foot={account === undefined ? null : <SidebarPerson account={account} fleetName={fleetName} isAllowedAsArgo={shown.argo !== undefined} />} />
  );
  const tabs = (shown: ShellCounts) => <BridgeTabs fleetId={fleetId} screen={screen} counts={shown} />;
  return (
    <div className="flex min-h-dvh">
      <Suspense fallback={sidebar(NO_COUNTS)}>
        <Counted counts={counts}>{sidebar}</Counted>
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <ShellFrame fleetId={fleetId} fleetName={fleetName} screen={screen} below={below} account={account} switcher={switcher}>
          {children}
        </ShellFrame>
        <Suspense fallback={tabs(NO_COUNTS)}>
          <Counted counts={counts}>{tabs}</Counted>
        </Suspense>
      </div>
    </div>
  );
}

/** A Bridge page on a gateway that signs no one in: the plain bar and why. */
export function BridgeNoSignIn() {
  return (
    <Frame header={<PlainHeader />}>
      <NoSignIn />
    </Frame>
  );
}
