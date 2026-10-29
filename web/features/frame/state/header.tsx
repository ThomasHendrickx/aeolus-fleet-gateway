import type { Theme } from '@aeolus-fleet/common';
import { Suspense } from 'react';

import { readHeader } from '../hooks/read-header';
import { headerSwitchersOf } from '../services/header-switchers';
import { GatewayHeader } from '../ui/gateway-header';
import { PlainHeader } from '../ui/plain-header';

/** The header for the account signed in, or the plain bar for no account (or one that may open no fleet here, or an answer it cannot read). */
export async function Header({ theme }: { theme: Theme }) {
  const answer = await readHeader();
  const switchers = answer === undefined ? [] : headerSwitchersOf(answer);
  if (answer === undefined || switchers.length === 0) {
    return <PlainHeader />;
  }
  return (
    // The header reads the fleet in view from the address.
    <Suspense fallback={<PlainHeader />}>
      <GatewayHeader switchers={switchers} email={answer.account.email} accountUrl={answer.apps.find(({ app }) => app === 'account')?.url} theme={theme} />
    </Suspense>
  );
}
